export function buildSequentialId(prefix, start, localAttempt, workerIndex, workerCount) {
  return `${prefix}${start + workerIndex + localAttempt * workerCount}`;
}

export function calculateLocalLimit(limit, workerIndex, workerCount) {
  if (workerIndex >= limit) {
    return 0;
  }

  return Math.ceil((limit - workerIndex) / workerCount);
}

export function getEffectiveWorkerCount(requestedWorkers, limit) {
  return Math.max(1, Math.min(requestedWorkers, limit));
}
