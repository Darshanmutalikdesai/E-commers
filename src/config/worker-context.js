import { AsyncLocalStorage } from "node:async_hooks";

const workerEnvironment = new AsyncLocalStorage();

export function runWithWorkerEnvironment(environment, callback) {
  return workerEnvironment.run(environment, callback);
}

export function getWorkerEnvironment() {
  return workerEnvironment.getStore();
}
