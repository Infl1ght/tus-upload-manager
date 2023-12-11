import { UploadOptions } from 'tus-js-client'
import UploadManager, { IUploadCallbacks, IUploadTask, IUploader, IUploaderConstructor } from '.'

const TIME_TO_TASK = 30
const TIME_DELTA = 30

const createUploader: IUploaderConstructor = function (
  file: any,
  options: UploadOptions
): IUploader {
  let aborted = false
  return {
    start: jest.fn().mockImplementation(() => {
      setTimeout(() => {
        if (options.onSuccess && !aborted) {
          options.onSuccess()
        }
      }, TIME_TO_TASK)
    }),
    abort: jest.fn().mockImplementation(() => {
      return new Promise<void>(res =>
        setTimeout(() => {
          aborted = true
          res()
        }, 20)
      )
    }),
  }
}

const createWithErrorUploader: IUploaderConstructor = function (
  file: any,
  options: {
    metadata?: any
    onError?: ((error: Error) => void) | null | undefined
    onProgress?: ((bytesSent: number, bytesTotal: number) => void) | null | undefined
    onSuccess?: (() => void) | null | undefined
  }
): IUploader {
  const mockErrorTasks = 1

  return {
    start: jest.fn().mockImplementation(() => {
      setTimeout(() => {
        if (options.metadata.id < mockErrorTasks) {
          if (options.onError) {
            options.onError(new Error())
          }
        } else {
          if (options.onSuccess) {
            options.onSuccess()
          }
        }
      }, TIME_TO_TASK)
    }),
    abort: () => {
      return Promise.resolve()
    },
  }
}

const onSuccessMock = jest.fn()
const onErrorMock = jest.fn()
const onStartMock = jest.fn()
const onHoldMock = jest.fn()

const getTasks = (flightId: number, numberOfTasks: number, startId = 0): IUploadTask[] => {
  const result = []
  for (let i = 0; i < numberOfTasks; i++) {
    result.push({
      file: new File([new ArrayBuffer(1000)], 'test'),
      id: i + startId,
      queueId: flightId,
      metadata: {
        id: i + startId,
      },
    })
  }
  return result
}

describe('Upload Manager', () => {
  let uploadManager: UploadManager
  const callbacks: IUploadCallbacks = {
    onSuccess: onSuccessMock,
    onError: onErrorMock,
    onProgress: jest.fn(),
    onStart: onStartMock,
    onHold: onHoldMock,
  }

  beforeEach(() => {
    onSuccessMock.mockClear()
    onErrorMock.mockClear()
    onStartMock.mockClear()
    onHoldMock.mockClear()

    uploadManager = new UploadManager(
      createUploader,
      callbacks,
      { uploadRetryDelays: [3000, 6000, 9000, 12000, 15000, 18000, 21000, 30000, 60000], maxUploadThreads: 3, onOfflineMessage: 'Offline', url: 'some_url' }
    )
  })
  it('Smoke test', () => {
    expect(uploadManager).toBeDefined()
  })

  it('Start 2 tasks', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 2)

    uploadManager.addUploadTasks(flightId, tasks)

    const holdEvent = onHoldMock.mock.calls
    expect(holdEvent[0][0].length).toBe(2)

    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(2)
  })

  it('Start 2 tasks, then add 2 tasks', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 2)
    const tasks_next = getTasks(flightId, 2, 2)

    uploadManager.addUploadTasks(flightId, tasks)
    uploadManager.addUploadTasks(flightId, tasks_next)
    await new Promise<void>(res => setTimeout(res, 2 * TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(4)
  })

  it('Start 2 tasks, then add 2 tasks after a while', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 2)

    uploadManager.addUploadTasks(flightId, tasks)
    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))
    uploadManager.addUploadTasks(flightId, tasks)
    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(4)
  })

  it('Start 2 tasks, 1 with error', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 2)
    uploadManager = new UploadManager(
      (file: any, options) => createWithErrorUploader(file, options), 
      callbacks, { uploadRetryDelays: [3000, 6000, 9000, 12000, 15000, 18000, 21000, 30000, 60000], maxUploadThreads: 3, onOfflineMessage: 'Offline', url: 'some_url' })

    uploadManager.addUploadTasks(flightId, tasks)
    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(1)

    expect(onErrorMock.mock.calls.length).toBe(1)
  })

  it('Start 3 tasks, delete 1 holding task', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 3)

    uploadManager.addUploadTasks(flightId, tasks)

    await uploadManager.deleteUploadTask(flightId, 1)
    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(2)
  })

  it('Start 2 tasks, delete 1 executing task', async () => {
    const flightId = 1
    const tasks = getTasks(flightId, 2)

    uploadManager.addUploadTasks(flightId, tasks)

    await uploadManager.deleteUploadTask(flightId, 0)
    await new Promise<void>(res => setTimeout(res, TIME_TO_TASK * tasks.length + TIME_DELTA))

    expect(onSuccessMock.mock.calls.length).toBe(1)
  })

  it('Start 4 queues, 1 queue must be on hold', async () => {
    const flightIds = [0, 1, 2, 3]
    const tasksQueue = flightIds.map(flightId => getTasks(flightId, 1))
    tasksQueue.forEach((tasks, index) => uploadManager.addUploadTasks(flightIds[index], tasks))

    expect(onStartMock.mock.calls.length).toBe(3)
    expect(onHoldMock.mock.calls.length).toBe(4)
  })

  it('Start queue, then abort it', async () => {
    const flightIds = [0]
    const tasksQueue = flightIds.map(flightId => getTasks(flightId, 1))
    tasksQueue.forEach((tasks, index) => uploadManager.addUploadTasks(flightIds[index], tasks))

    uploadManager.stopUploadingForQueue(0)

    expect(onStartMock.mock.calls.length).toBe(1)
    expect(onHoldMock.mock.calls.length).toBe(1)
    expect(onErrorMock.mock.calls.length).toBe(0)
    expect(onSuccessMock.mock.calls.length).toBe(0)
  })
})
