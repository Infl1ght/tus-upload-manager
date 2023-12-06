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
const _1 = __importDefault(require("."));
const TIME_TO_TASK = 30;
const TIME_DELTA = 30;
const createUploader = function (file, options) {
    let aborted = false;
    return {
        start: jest.fn().mockImplementation(() => {
            setTimeout(() => {
                if (options.onSuccess && !aborted) {
                    options.onSuccess();
                }
            }, TIME_TO_TASK);
        }),
        abort: jest.fn().mockImplementation(() => {
            return new Promise(res => setTimeout(() => {
                aborted = true;
                res();
            }, 20));
        }),
    };
};
const createWithErrorUploader = function (file, options) {
    const mockErrorTasks = 1;
    return {
        start: jest.fn().mockImplementation(() => {
            setTimeout(() => {
                if (options.metadata.photoId < mockErrorTasks) {
                    if (options.onError) {
                        options.onError(new Error());
                    }
                }
                else {
                    if (options.onSuccess) {
                        options.onSuccess();
                    }
                }
            }, TIME_TO_TASK);
        }),
        abort: () => {
            return Promise.resolve();
        },
    };
};
const onSuccessMock = jest.fn();
const onErrorMock = jest.fn();
const onStartMock = jest.fn();
const onHoldMock = jest.fn();
const getTasks = (flightId, numberOfTasks, startId = 0) => {
    const result = [];
    for (let i = 0; i < numberOfTasks; i++) {
        result.push({
            file: new File([new ArrayBuffer(1000)], 'test'),
            id: i + startId,
            queueId: flightId,
            meta: undefined,
        });
    }
    return result;
};
describe('Upload Manager', () => {
    let uploadManager;
    const callbacks = {
        onSuccess: onSuccessMock,
        onError: onErrorMock,
        onProgress: jest.fn(),
        onStart: onStartMock,
        onHold: onHoldMock,
    };
    beforeEach(() => {
        onSuccessMock.mockClear();
        onErrorMock.mockClear();
        onStartMock.mockClear();
        onHoldMock.mockClear();
        uploadManager = new _1.default(createUploader, callbacks, { uploadRetryDelays: [3000, 6000, 9000, 12000, 15000, 18000, 21000, 30000, 60000], maxUploadThreads: 3, onOfflineMessage: 'Offline' });
    });
    it('Smoke test', () => {
        expect(uploadManager).toBeDefined();
    });
    it('Start 2 tasks', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 2);
        uploadManager.addUploadTasks(flightId, tasks);
        const holdEvent = onHoldMock.mock.calls;
        expect(holdEvent[0][0].length).toBe(2);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(2);
    }));
    it('Start 2 tasks, then add 2 tasks', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 2);
        const tasks_next = getTasks(flightId, 2, 2);
        uploadManager.addUploadTasks(flightId, tasks);
        uploadManager.addUploadTasks(flightId, tasks_next);
        yield new Promise(res => setTimeout(res, 2 * TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(4);
    }));
    it('Start 2 tasks, then add 2 tasks after a while', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 2);
        uploadManager.addUploadTasks(flightId, tasks);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        uploadManager.addUploadTasks(flightId, tasks);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(4);
    }));
    it('Start 2 tasks, 1 with error', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 2);
        uploadManager = new _1.default(createWithErrorUploader, callbacks, { uploadRetryDelays: [3000, 6000, 9000, 12000, 15000, 18000, 21000, 30000, 60000], maxUploadThreads: 3, onOfflineMessage: 'Offline' });
        uploadManager.addUploadTasks(flightId, tasks);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(1);
        expect(onErrorMock.mock.calls.length).toBe(1);
    }));
    it('Start 3 tasks, delete 1 holding task', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 3);
        uploadManager.addUploadTasks(flightId, tasks);
        yield uploadManager.deleteUploadTask(flightId, 1);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(2);
    }));
    it('Start 2 tasks, delete 1 executing task', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightId = 1;
        const tasks = getTasks(flightId, 2);
        uploadManager.addUploadTasks(flightId, tasks);
        yield uploadManager.deleteUploadTask(flightId, 0);
        yield new Promise(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA));
        expect(onSuccessMock.mock.calls.length).toBe(1);
    }));
    it('Start 4 queues, 1 queue must be on hold', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightIds = [0, 1, 2, 3];
        const tasksQueue = flightIds.map(flightId => getTasks(flightId, 1));
        tasksQueue.forEach((tasks, index) => uploadManager.addUploadTasks(flightIds[index], tasks));
        expect(onStartMock.mock.calls.length).toBe(3);
        expect(onHoldMock.mock.calls.length).toBe(4);
    }));
    it('Start queue, then abort it', () => __awaiter(void 0, void 0, void 0, function* () {
        const flightIds = [0];
        const tasksQueue = flightIds.map(flightId => getTasks(flightId, 1));
        tasksQueue.forEach((tasks, index) => uploadManager.addUploadTasks(flightIds[index], tasks));
        uploadManager.stopUploadingForQueue(0);
        expect(onStartMock.mock.calls.length).toBe(1);
        expect(onHoldMock.mock.calls.length).toBe(1);
        expect(onErrorMock.mock.calls.length).toBe(0);
        expect(onSuccessMock.mock.calls.length).toBe(0);
    }));
});
