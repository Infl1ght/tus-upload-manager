import PQueue from 'p-queue';
import { PreviousUpload, UploadOptions } from 'tus-js-client';
export interface IUploadTask {
    file: File;
    id: number;
    queueId: number;
    tusdId?: string;
    metadata?: any;
    headers?: any;
}
export interface IUploaderConstructor {
    (file: File | Blob, options: UploadOptions): IUploader;
}
export interface IUploader {
    start(): void;
    abort(shouldTerminate?: boolean): Promise<void>;
    findPreviousUploads(): Promise<PreviousUpload[]>;
    resumeFromPreviousUpload(previousUpload: PreviousUpload): void;
}
export interface IUploadCallbacks {
    onSuccess(taskId: number): void;
    onError(taskId: number, error: any): void;
    onProgress(taskId: number, bytesUploaded: number, bytesTotal: number, percentage: number): void;
    onStart(taskId: number): void;
    onHold(taskId: number[]): void;
}
export declare class UploadQueue {
    callbacks: IUploadCallbacks;
    queueId: number;
    url: string;
    chunkSize: number;
    abortControllers: {
        [id: number]: AbortController;
    };
    queue: PQueue;
    currentTaskId: number | undefined;
    createUploader: IUploaderConstructor;
    constructor(callbacks: IUploadCallbacks, createUploader: IUploaderConstructor, queueId: number, url: string, chunkSize: number);
    addNewTask(task: IUploadTask, uploadRetryDelays: number[]): void;
    addTasks(tasks: IUploadTask[], uploadRetryDelays: number[]): Promise<void>;
    deleteUploadTask(taskId: number): Promise<void>;
    start(tasks: IUploadTask[], uploadRetryDelays: number[]): Promise<number>;
    abort(): Promise<void>;
}
export interface IUploadManagerOptions {
    maxUploadThreads: number;
    uploadRetryDelays: number[];
    url: string;
    onOfflineMessage?: string;
    chunkSize?: number;
}
declare class UploadManager {
    uploadQueues: {
        [queueId: string]: UploadQueue;
    };
    queue: PQueue;
    createUploader: IUploaderConstructor;
    callbacks: IUploadCallbacks | undefined;
    maxUploadThreads: number;
    uploadRetryDelays: number[];
    onOfflineMessage: string | undefined;
    url: string;
    chunkSize: number;
    constructor(createUploader: IUploaderConstructor, callbacks: IUploadCallbacks, options: IUploadManagerOptions);
    addUploadTasks(queueId: number, tasks: IUploadTask[]): void;
    deleteUploadTask(queueId: number, taskId: number): Promise<void>;
    stopUploadingForQueue(queueId: number): Promise<void>;
}
export default UploadManager;
