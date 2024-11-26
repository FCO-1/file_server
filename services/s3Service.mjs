import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Queue from 'better-queue';
import SQLite3Store from 'better-queue-sqlite';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
//import { Console } from "console";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Promisify fs methods
const access = promisify(fs.access);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

export const S3SyncStatus = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Sanitiza los metadatos para S3
 * @private
 */
function sanitizeMetadata(metadata) {
    if (!metadata) return {};
    
    // Convertir todos los valores a strings y eliminar caracteres no válidos
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value != null) {
        // Convertir el valor a string y eliminar caracteres no válidos
        sanitized[key] = String(value).replace(/[^\x20-\x7E]/g, '');
      }
    }
    return sanitized;
  }

export class S3Service {
  constructor(config) {
    this.config = {
      bucket: config.bucket,
      region: config.region,
      maxConcurrent: config.maxConcurrent || 3,
      queueDbPath: config.queueDbPath || path.join(__dirname, '../data/s3-queue.db'),
      retryDelay: config.retryDelay || 5000,
      maxRetries: config.maxRetries || 3
    };

    this.s3Client = new S3Client({
      region: this.config.region
    });

    this.events = new EventEmitter();
    this.syncRegistry = new Map();
    
    this.initializeQueue();
  }

  async initializeQueue() {
    try {
      const queueDir = path.dirname(this.config.queueDbPath);
      if (!fs.existsSync(queueDir)) {
        await mkdir(queueDir, { recursive: true });
      }

      this.queueStore = new SQLite3Store({
        path: this.config.queueDbPath
      });

      this.queue = new Queue(async (task, cb) => {
        try {
          await this.uploadToS3(task);
          cb(null, { status: 'completed', key: task.s3Key });
        } catch (error) {
          console.error('Error in queue processing:', error);
          cb(error);
        }
      }, {
        store: this.queueStore,
        concurrent: this.config.maxConcurrent,
        maxRetries: this.config.maxRetries,
        retryDelay: this.config.retryDelay
      });

      this.setupQueueEvents();
    } catch (error) {
      console.error('Error initializing queue:', error);
      throw error;
    }
  }

  setupQueueEvents() {
    this.queue
      .on('task_finish', (taskId, result) => {
        this.updateSyncStatus(taskId, S3SyncStatus.COMPLETED);
        this.events.emit('syncCompleted', { taskId, result });
      })
      .on('task_failed', (taskId, error) => {
        this.updateSyncStatus(taskId, S3SyncStatus.FAILED, error.message);
        this.events.emit('syncFailed', { taskId, error });
      })
      .on('task_retry', (taskId, error) => {
        this.events.emit('syncRetry', { taskId, error });
      });
  }

  async uploadToS3(task) {
    const { filePath, s3Key, metadata = {} } = task;
    
    try {
      // Verificar si el archivo existe
      await promisify(fs.access)(filePath, fs.constants.F_OK);
      
      // Leer el archivo
      const fileContent = await promisify(fs.readFile)(filePath);
      
      // Sanitizar y preparar metadatos
      const sanitizedMetadata = sanitizeMetadata(metadata);

      // Determinar el Content-Type
      const contentType = metadata?.contentType || 'application/octet-stream';

      const uploadParams = {
        Bucket: this.config.bucket,
        Key: s3Key,
        Body: fileContent,
        ContentType: contentType,
        Metadata: sanitizedMetadata
      };

      // Remover campos que no son metadatos válidos
      if (sanitizedMetadata.contentType) {
        delete sanitizedMetadata.contentType;
      }
      if (sanitizedMetadata.deleteAfterUpload) {
        delete sanitizedMetadata.deleteAfterUpload;
      }

      try {
        const command = new PutObjectCommand(uploadParams);
        await this.s3Client.send(command);
        console.log("Sincronización completa")
        
        if (metadata?.deleteAfterUpload) {
          await promisify(fs.unlink)(filePath);
        }
      } catch (error) {
        console.error('AWS S3 Error:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error uploading to S3:', error);
      throw error;
    }
  }


  async queueForSync(fileInfo) {
    return new Promise((resolve, reject) => {
      const taskId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.syncRegistry.set(taskId, {
        status: S3SyncStatus.PENDING,
        startTime: Date.now(),
        fileInfo
      });

      this.queue.push(fileInfo, (err) => {
        if (err) {
          this.updateSyncStatus(taskId, S3SyncStatus.FAILED, err.message);
          reject(err);
        } else {
          resolve(taskId);
        }
      });
    });
  }

  updateSyncStatus(taskId, status, error = null) {
    const syncInfo = this.syncRegistry.get(taskId);
    if (syncInfo) {
      syncInfo.status = status;
      syncInfo.error = error;
      syncInfo.completedTime = Date.now();
    }
  }

  getSyncStatus(taskId) {
    const syncInfo = this.syncRegistry.get(taskId);
    if (!syncInfo) {
      throw new Error('Sync task not found');
    }
    return {
      ...syncInfo,
      queueSize: this.queue.length,
      activeUploads: this.queue.running
    };
  }

  getQueueStats() {
    return {
      queueSize: this.queue.length,
      activeUploads: this.queue.running,
      maxConcurrent: this.config.maxConcurrent,
      pendingTasks: Array.from(this.syncRegistry.entries())
        .filter(([_, info]) => info.status === S3SyncStatus.PENDING).length,
      failedTasks: Array.from(this.syncRegistry.entries())
        .filter(([_, info]) => info.status === S3SyncStatus.FAILED).length
    };
  }

  on(event, handler) {
    this.events.on(event, handler);
  }

  async shutdown() {
    return new Promise((resolve) => {
      this.queue.destroy(() => {
        this.queueStore.close();
        resolve();
      });
    });
  }
}

// Crear y exportar instancia por defecto
export const s3Service = new S3Service({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});