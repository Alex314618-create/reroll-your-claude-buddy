import { generateRandomId, matchesFilters, rollUserId } from "./shared/buddy-core.js";
import { buildSequentialId, calculateLocalLimit } from "./shared/search-plan.js";

let shouldStop = false;

function runSearch(payload) {
  const { filters, options } = payload;
  const {
    mode,
    prefix,
    start,
    bytes,
    limit,
    algorithm,
    workerIndex,
    workerCount,
  } = options;

  const localLimit = calculateLocalLimit(limit, workerIndex, workerCount);
  let attempts = 0;

  for (let localAttempt = 0; localAttempt < localLimit; localAttempt += 1) {
    if (shouldStop) {
      break;
    }

    const userId =
      mode === "sequential"
        ? buildSequentialId(prefix, start, localAttempt, workerIndex, workerCount)
        : generateRandomId(bytes);

    const bones = rollUserId(userId, algorithm);
    attempts += 1;

    if (matchesFilters(bones, filters)) {
      self.postMessage({
        type: "match",
        workerIndex,
        attempts,
        result: {
          userId,
          bones,
        },
      });
    }

    if (attempts % 10000 === 0) {
      self.postMessage({
        type: "progress",
        workerIndex,
        attempts,
      });
    }
  }

  self.postMessage({
    type: "done",
    workerIndex,
    attempts,
    stopped: shouldStop,
  });
}

self.onmessage = (event) => {
  const { data } = event;

  if (data.type === "stop") {
    shouldStop = true;
    return;
  }

  if (data.type === "start") {
    shouldStop = false;

    try {
      runSearch(data.payload);
    } catch (error) {
      self.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
