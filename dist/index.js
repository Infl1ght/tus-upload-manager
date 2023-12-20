"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadQueue = void 0;
const p_queue_1 = __importDefault(require("p-queue"));
class UploadQueue {
    constructor(callbacks, createUploader, queueId, url) {
        this.url = '';
        this.abortControllers = {};
        this.queue = new p_queue_1.default({ concurrency: 1 });
        this.currentTaskId = undefined;
        this.callbacks = callbacks;
        this.queueId = queueId;
        this.url = url;
        this.createUploader = createUploader;
    }
    addNewTask(task, uploadRetryDelays) {
        this.queue.add(({ signal }) => {
            try {
                if (!this.abortControllers[task.id]) {
                    return true;
                }
                this.currentTaskId = task.id;
                return new Promise((resolve, reject) => {
                    const uploader = this.createUploader(task.file, {
                        endpoint: this.url,
                        uploadUrl: (task === null || task === void 0 ? void 0 : task.tusdId) ? `${this.url}${task === null || task === void 0 ? void 0 : task.tusdId}` : undefined,
                        retryDelays: uploadRetryDelays,
                        metadata: task.metadata,
                        headers: task.headers,
                        onError: error => {
                            this.callbacks.onError(task.id, error);
                            this.currentTaskId = undefined;
                            delete this.abortControllers[task.id];
                            resolve(error);
                        },
                        onShouldRetry: (error, retryAttempt, options) => {
                            var status = error.originalResponse ? error.originalResponse.getStatus() : 0;
                            if (status === 403) {
                                return false;
                            }
                            return true;
                        },
                        onProgress: (bytesUploaded, bytesTotal) => __awaiter(this, void 0, void 0, function* () {
                            const percentage = parseFloat(((bytesUploaded / bytesTotal) * 100).toFixed(2));
                            this.callbacks.onProgress(task.id, bytesUploaded, bytesTotal, percentage);
                        }),
                        onSuccess: () => {
                            this.callbacks.onSuccess(task.id);
                            this.currentTaskId = undefined;
                            delete this.abortControllers[task.id];
                            resolve(true);
                        },
                    });
                    this.callbacks.onStart(task.id);
                    uploader.start();
                    signal === null || signal === void 0 ? void 0 : signal.addEventListener('abort', () => __awaiter(this, void 0, void 0, function* () {
                        try {
                            delete this.abortControllers[task.id];
                            yield uploader.abort();
                            signal === null || signal === void 0 ? void 0 : signal.dispatchEvent(new Event('abort_complete'));
                            resolve(true);
                        }
                        catch (error) {
                            console.error(error);
                        }
                    }));
                });
            }
            catch (error) {
                this.callbacks.onError(task.id, error);
            }
        }, { signal: this.abortControllers[task.id].signal });
    }
    addTasks(tasks, uploadRetryDelays) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                tasks.forEach((task) => __awaiter(this, void 0, void 0, function* () {
                    this.abortControllers[task.id] = new AbortController();
                }));
                tasks.forEach(task => {
                    this.addNewTask(task, uploadRetryDelays);
                });
            }
            catch (error) {
                tasks.forEach(task => {
                    this.callbacks.onError(task.id, error);
                });
            }
        });
    }
    deleteUploadTask(taskId) {
        return new Promise(res => {
            var _a;
            if (this.currentTaskId !== taskId) {
                delete this.abortControllers[taskId];
                res();
            }
            else {
                const onAborted = () => res();
                this.abortControllers[taskId].signal.addEventListener('abort_complete', onAborted);
                (_a = this.abortControllers[taskId]) === null || _a === void 0 ? void 0 : _a.abort();
            }
        });
    }
    start(tasks, uploadRetryDelays) {
        return new Promise((res, rej) => {
            this.addTasks(tasks, uploadRetryDelays);
            this.queue.on('idle', () => {
                this.currentTaskId = undefined;
                res(this.queueId);
            });
            this.queue.on('error', e => {
                console.error('Error with task queue ' + this.queueId);
                console.error(e);
            });
        });
    }
    abort() {
        return new Promise(res => {
            var _a;
            this.queue.clear();
            if (this.currentTaskId && this.abortControllers[this.currentTaskId]) {
                const onAborted = () => res();
                this.abortControllers[this.currentTaskId].signal.addEventListener('abort_complete', onAborted);
                (_a = this.abortControllers[this.currentTaskId]) === null || _a === void 0 ? void 0 : _a.abort();
            }
            else {
                res();
            }
        });
    }
}
exports.UploadQueue = UploadQueue;
class UploadManager {
    constructor(createUploader, callbacks, options) {
        this.uploadQueues = {};
        this.queue = new p_queue_1.default();
        this.callbacks = undefined;
        this.onOfflineMessage = undefined;
        this.createUploader = createUploader;
        this.callbacks = callbacks;
        this.maxUploadThreads = options.maxUploadThreads;
        this.uploadRetryDelays = options.uploadRetryDelays;
        this.onOfflineMessage = options.onOfflineMessage;
        this.url = options.url;
        this.queue = new p_queue_1.default({ concurrency: this.maxUploadThreads });
        this.queue.on('completed', queueId => {
            delete this.uploadQueues[queueId];
        });
        this.queue.on('error', error => console.error('Some error with queue: ' + error));
        window.addEventListener('beforeunload', event => {
            if (this.queue.pending > 0) {
                event.preventDefault();
                event.returnValue = '';
            }
            else {
                delete event['returnValue'];
            }
        });
        window.addEventListener('offline', e => {
            if (this.queue.pending > 0 && this.onOfflineMessage) {
                alert(this.onOfflineMessage);
            }
        });
    }
    addUploadTasks(queueId, tasks) {
        if (this.callbacks === undefined) {
            throw new Error('UploadManager is not inited');
        }
        if (!tasks.length) {
            return;
        }
        const callbacks = this.callbacks;
        callbacks.onHold(tasks.map(item => item.id));
        if (!this.uploadQueues[queueId]) {
            this.queue.add(() => {
                this.uploadQueues[queueId] = new UploadQueue(callbacks, this.createUploader, queueId, this.url);
                return this.uploadQueues[queueId].start(tasks, this.uploadRetryDelays);
            });
        }
        else {
            this.uploadQueues[queueId].addTasks(tasks, this.uploadRetryDelays);
        }
    }
    deleteUploadTask(queueId, taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const uploadQueue = this.uploadQueues[queueId];
            if (!uploadQueue) {
                return;
            }
            yield uploadQueue.deleteUploadTask(taskId);
        });
    }
    stopUploadingForQueue(queueId) {
        return __awaiter(this, void 0, void 0, function* () {
            const uploadQueue = this.uploadQueues[queueId];
            if (!uploadQueue) {
                return;
            }
            yield uploadQueue.abort();
        });
    }
}
exports.default = UploadManager;
