const Client = require('../lib/Client');
const VariableService = require('../lib/__internal/VariableService');
const TaskService = require('../lib/TaskService');

const {
  WRONG_INTERCEPTOR,
  MISSING_BASE_URL,
  ALREADY_REGISTERED,
  MISSING_HANDLER,
  WRONG_MIDDLEWARES
} = require('../lib/__internal/errors');

jest.mock('got');


const customClientOptions = {
  baseUrl: 'http://localhost:XXXX/engine-rest/',
  workerId: 'foobarId',
  maxTasks: 3,
  interval: 100,
  lockDuration: 30000
};

describe('Client', () => {
  describe('poll ', () => {
    jest.useFakeTimers();
    describe('when autoPoll is false', () => {
      let pollSpy, client, engineService;

      beforeEach(() => {
        client = new Client({ ...customClientOptions, autoPoll: false });
        engineService = client.engineService;
        pollSpy = jest.spyOn(client, 'poll');
      });

      test('calling start should call poll', () => {
        // when
        client.start();

        //then
        expect(pollSpy).toHaveBeenCalled();
      });

      test('should call itself again after timeout when there are no topic subscriptions', () => {
        // when
        client.start();
        jest.advanceTimersByTime(customClientOptions.interval);

        // then
        expect(pollSpy).toHaveBeenCalledTimes(2);
      });

      test('should not call itself again after timeout when there are registered client', () => {
        //given
        client.subscribe('foo', () => {});

        // when
        client.start();
        jest.advanceTimersByTime(customClientOptions.interval);

        // then
        expect(pollSpy).toHaveBeenCalledTimes(1);
      });

      test('should fetchAndLock and then call itself again when there are registered client', async() => {
        // given
        const fetchAndLockSpy = jest.spyOn(engineService, 'fetchAndLock');
        client.subscribe('foo', () => {});

        // when
        client.start();
        jest.advanceTimersByTime(customClientOptions.interval);

        //then
        expect(fetchAndLockSpy).toBeCalled();
        await(engineService.fetchAndLock({}));
        jest.advanceTimersByTime(customClientOptions.interval);
        expect(pollSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('when autoPoll is true', () => {
      it('should call itself automatically when autoPoll is true', () => {
        // given
        const client = new Client({ ...customClientOptions, autoPoll: true });
        const pollSpy = jest.spyOn(client, 'poll');

        //when
        jest.advanceTimersByTime(2*customClientOptions.interval);

        // then
        expect(pollSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('stop', () => {
      it('should stop polling', () => {
        // given: we advance time twice then call stop
        const client = new Client(customClientOptions);
        jest.advanceTimersByTime(2*customClientOptions.interval);
        client.stop();
        const pollSpy = jest.spyOn(client, 'poll');

        // when
        jest.advanceTimersByTime(2*customClientOptions.interval);

        // then
        expect(pollSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('subscribe', () => {

    test('should throw error if api baseUrl wasn\'t passed as parameter', () => {
      expect(() => { new Client();}).toThrowError(MISSING_BASE_URL);
    });

    let client, fooWork, customConfig;

    beforeEach( () => {
      client = new Client(customClientOptions);
      fooWork = () => 'foobar';
      customConfig = { lockDuration: 3000 };
    });

    test('should overwrite default with custom client config', () =>{
      expect(client.options.workerId).toBe(customClientOptions.workerId);
      expect(client.options.maxTasks).toBe(customClientOptions.maxTasks);
      expect(client.options.interval).toBe(customClientOptions.interval);
      expect(client.options.lockDuration).toBe(customClientOptions.lockDuration);
    });


    test('should subscribe to topic without custom config ', () => {
      // given
      const footopicSubscription = client.subscribe('foo', fooWork);

      // then
      expect(footopicSubscription.handler).not.toBeUndefined();
    });

    test('should subscribe to topic with custom config ', () =>{
      // given
      const footopicSubscription = client.subscribe('foo', customConfig, fooWork);

      // then
      expect(footopicSubscription.lockDuration).toBe(customConfig.lockDuration);
    });

    test('should throw error if try to subscribe twice', () => {
      // given
      client.subscribe('foo', fooWork);

      // then
      expect(() => { client.subscribe('foo', fooWork); }).toThrowError(ALREADY_REGISTERED);
    });

    test('should throw error if handler is not passed', () => {
      expect(() => { client.subscribe('foo2'); }).toThrowError(MISSING_HANDLER);
    });


    test('should allow to unsubscribe from a topic', () => {
      // given
      const footopicSubscription = client.subscribe('foo', fooWork);

      // when
      footopicSubscription.unsubscribe();

      // then
      expect(client.topicSubscriptions['foo']).toBeUndefined();
    });



  });

  describe('interceptors', () => {
    it('should not add interceptors if they are not provided as a function or array of functions', () => {
      // given
      const options = { ...customClientOptions, interceptors: [] };

      // then
      expect(() => new Client(options)).toThrowError(WRONG_INTERCEPTOR);
    });

    it('should add interceptors if they are provided as a function', () => {
      // given
      const foo = () => {};
      const expectedInterceptors = [foo];
      const options ={ ...customClientOptions, interceptors: foo };
      const client = new Client(options);

      // then
      expect(client.engineService.interceptors).toEqual(expectedInterceptors);
    });

    it('should add interceptors if they are provided as an array of functions', () => {
      // given
      const foo = () => {};
      const expectedInterceptors = [foo];
      const options = { ...customClientOptions, interceptors: [foo] };
      const client = new Client(options);

      // then
      expect(client.engineService.interceptors).toEqual(expectedInterceptors);

    });
  });

  describe('middlewares', () => {
    it('should not add middlewares if they are not provided as a function or array of functions', () => {
      // given
      const options = { ...customClientOptions, use: [] };

      // then
      expect(() => new Client(options)).toThrowError(WRONG_MIDDLEWARES);
    });

    it('should accept middleware function', () => {
      //givena
      const middleware = jest.fn();
      const options = { ...customClientOptions, use: middleware };
      const client = new Client(options);

      //then
      expect(middleware).toBeCalledWith(client);
    });

    it('should accept middlewares array', () => {
      //given
      const middlewares = [jest.fn(), jest.fn()];
      const options = { ...customClientOptions, use: middlewares };
      const client = new Client(options);

      //then
      middlewares.forEach(middleware => expect(middleware).toBeCalledWith(client));
    });
  });

  describe('executeTask', () => {
    let client;
    const handler = jest.fn();

    beforeEach(() => {
      client = new Client({ ...customClientOptions, autoPoll: false });
      client.subscribe('foo', handler);
    });

    test('should call handler with task and taskService', () => {
      // given
      const expectedTask = { topicName: 'foo', variables: {} };

      // when
      client.executeTask(expectedTask);

      // then
      expect(handler).toBeCalled();
      const { task, taskService } = handler.mock.calls[0][0];
      expect(taskService).toBeInstanceOf(TaskService);
      expect(task).toBeDefined();
      expect(task.topicName).toBe(expectedTask.topicName);
      expect(task.variables).toBeInstanceOf(VariableService);
    });

  });
});
