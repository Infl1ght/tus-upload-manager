import PQueue from 'p-queue'
import { UploadOptions } from 'tus-js-client'

export interface IUploadTask {
  file: File
  id: number
  queueId: number
  tusdId?: string
  metadata?: any
  headers?: any
}

export interface IUploaderConstructor {
  (file: File | Blob, options: UploadOptions): IUploader
}

export interface IUploader {
  start(): void
  abort(shouldTerminate?: boolean): Promise<void>
}

export interface IUploadCallbacks {
  onSuccess(taskId: number): void
  onError(taskId: number, error: any): void
  onProgress(taskId: number, bytesUploaded: number, bytesTotal: number, percentage: number): void
  onStart(taskId: number): void
  onHold(taskId: number[]): void
}

export class UploadQueue {
  callbacks: IUploadCallbacks
  queueId: number
  url: string = ''

  abortControllers: { [id: number]: AbortController } = {}
  queue: PQueue = new PQueue({ concurrency: 1 })
  currentTaskId: number | undefined = undefined
  createUploader: IUploaderConstructor

  constructor(callbacks: IUploadCallbacks, createUploader: IUploaderConstructor, queueId: number, url: string) {
    this.callbacks = callbacks
    this.queueId = queueId
    this.url = url
    this.createUploader = createUploader
  }

  addNewTask(task: IUploadTask, uploadRetryDelays: number[]) {
    this.queue.add(
      ({ signal }) => {
        try {
          if (!this.abortControllers[task.id]) {
            return true
          }
          this.currentTaskId = task.id
          return new Promise((resolve, reject) => {
            const uploader = this.createUploader(task.file, {
              endpoint: this.url,
              uploadUrl: task?.tusdId ? `${this.url}${task?.tusdId}` : undefined,
              retryDelays: uploadRetryDelays,
              metadata: task.metadata,
              headers: task.headers,
              onError: error => {
                this.callbacks.onError(task.id, error)
                this.currentTaskId = undefined
                delete this.abortControllers[task.id]
                resolve(error)
              },
              onShouldRetry: (error: any, retryAttempt: number, options: UploadOptions) => {
                var status = error.originalResponse ? error.originalResponse.getStatus() : 0
                if (status === 403) {
                  return false
                }
                return true
              },
              onProgress: async (bytesUploaded, bytesTotal) => {
                const percentage = parseFloat(((bytesUploaded / bytesTotal) * 100).toFixed(2))
                this.callbacks.onProgress(task.id, bytesUploaded, bytesTotal, percentage)
              },
              onSuccess: () => {
                this.callbacks.onSuccess(task.id)
                this.currentTaskId = undefined
                delete this.abortControllers[task.id]
                resolve(true)
              },
            })
            this.callbacks.onStart(task.id)
            uploader.start()

            signal?.addEventListener('abort', async () => {
              try {
                delete this.abortControllers[task.id]
                await uploader.abort()
                signal?.dispatchEvent(new Event('abort_complete'))
                resolve(true)
              } catch (error) {
                console.error(error)
              }
            })
          })
        } catch (error) {
          this.callbacks.onError(task.id, error)
        }
      },
      { signal: this.abortControllers[task.id].signal }
    )
  }

  async addTasks(tasks: IUploadTask[], uploadRetryDelays: number[]) {
    tasks.forEach(async task => {
      this.abortControllers[task.id] = new AbortController()
    })
    tasks.forEach(task => {
      this.addNewTask(task, uploadRetryDelays)
    })
  }

  deleteUploadTask(taskId: number) {
    return new Promise<void>(res => {
      if (this.currentTaskId !== taskId) {
        delete this.abortControllers[taskId]
        res()
      } else {
        const onAborted = () => res()
        this.abortControllers[taskId].signal.addEventListener('abort_complete', onAborted)
        this.abortControllers[taskId]?.abort()
      }
    })
  }

  start(tasks: IUploadTask[], uploadRetryDelays: number[]) {
    return new Promise<number>((res, rej) => {
      this.addTasks(tasks, uploadRetryDelays)
      this.queue.on('idle', () => {
        this.currentTaskId = undefined
        res(this.queueId)
      })
      this.queue.on('error', e => {
        console.error('Error with task queue ' + this.queueId)
        console.error(e)
      })
    })
  }

  abort() {
    return new Promise<void>(res => {
      this.queue.clear()
      if (this.currentTaskId && this.abortControllers[this.currentTaskId]) {
        const onAborted = () => res()
        this.abortControllers[this.currentTaskId].signal.addEventListener('abort_complete', onAborted)
        this.abortControllers[this.currentTaskId]?.abort()
      } else {
        res()
      }
    })
  }
}

export interface IUploadManagerOptions {
  maxUploadThreads: number
  uploadRetryDelays: number[]
  url: string
  onOfflineMessage?: string
}

class UploadManager {
  uploadQueues: { [queueId: string]: UploadQueue } = {}
  queue: PQueue = new PQueue()
  createUploader: IUploaderConstructor
  callbacks: IUploadCallbacks | undefined = undefined
  maxUploadThreads: number
  uploadRetryDelays: number[]
  onOfflineMessage: string | undefined = undefined
  url: string

  constructor(createUploader: IUploaderConstructor, callbacks: IUploadCallbacks, options: IUploadManagerOptions) {
    this.createUploader = createUploader
    this.callbacks = callbacks
    this.maxUploadThreads = options.maxUploadThreads
    this.uploadRetryDelays = options.uploadRetryDelays
    this.onOfflineMessage = options.onOfflineMessage
    this.url = options.url

    this.queue = new PQueue({ concurrency: this.maxUploadThreads })

    this.queue.on('completed', queueId => {
      delete this.uploadQueues[queueId]
    })
    this.queue.on('error', error => console.error('Some error with queue: ' + error))

    window.addEventListener('beforeunload', event => {
      if (this.queue.pending > 0) {
        event.preventDefault()
        event.returnValue = ''
      } else {
        delete event['returnValue']
      }
    })

    window.addEventListener('offline', e => {
      if (this.queue.pending > 0 && this.onOfflineMessage) {
        alert(this.onOfflineMessage)
      }
    })
  }

  addUploadTasks(queueId: number, tasks: IUploadTask[]) {
    if (this.callbacks === undefined) {
      throw new Error('UploadManager is not inited')
    }
    if (!tasks.length) {
      return
    }
    const callbacks: IUploadCallbacks = this.callbacks
    callbacks.onHold(tasks.map(item => item.id))
    if (!this.uploadQueues[queueId]) {
      this.queue.add(() => {
        this.uploadQueues[queueId] = new UploadQueue(callbacks, this.createUploader, queueId, this.url)
        return this.uploadQueues[queueId].start(tasks, this.uploadRetryDelays)
      })
    } else {
      this.uploadQueues[queueId].addTasks(tasks, this.uploadRetryDelays)
    }
  }

  async deleteUploadTask(queueId: number, taskId: number) {
    const uploadQueue = this.uploadQueues[queueId]
    if (!uploadQueue) {
      return
    }
    await uploadQueue.deleteUploadTask(taskId)
  }

  async stopUploadingForQueue(queueId: number) {
    const uploadQueue = this.uploadQueues[queueId]
    if (!uploadQueue) {
      return
    }
    await uploadQueue.abort()
  }
}

export default UploadManager
