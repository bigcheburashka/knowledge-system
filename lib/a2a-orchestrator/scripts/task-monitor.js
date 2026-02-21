/**
 * Task Monitor - monitors async task execution (not processes)
 * Tracks: timeouts, hangs, completion status
 */
class TaskMonitor {
  constructor(options = {}) {
    this.tasks = new Map();
    this.defaultTimeout = options.timeout || 30000; // 30 seconds
  }

  /**
   * Start monitoring a task
   */
  startTask(taskId, metadata = {}) {
    this.tasks.set(taskId, {
      id: taskId,
      startedAt: Date.now(),
      timeout: metadata.timeout || this.defaultTimeout,
      metadata,
      status: 'running'
    });
  }

  /**
   * Mark task as completed
   */
  completeTask(taskId, result = {}) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.duration = task.completedAt - task.startedAt;
      task.result = result;
    }
  }

  /**
   * Mark task as failed
   */
  failTask(taskId, error) {
    const task = taskId = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.failedAt = Date.now();
      task.error = error.message;
    }
  }

  /**
   * Check if task is hanging (timeout exceeded)
   */
  isHanging(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;
    
    const elapsed = Date.now() - task.startedAt;
    return elapsed > task.timeout;
  }

  /**
   * Get hanging tasks
   */
  getHangingTasks() {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'running' && this.isHanging(t.id));
  }

  /**
   * Get task status
   */
  getStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    return {
      id: task.id,
      status: task.status,
      duration: Date.now() - task.startedAt,
      isHanging: this.isHanging(taskId)
    };
  }

  /**
   * Get all tasks summary
   */
  getSummary() {
    const tasks = Array.from(this.tasks.values());
    return {
      total: tasks.length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      hanging: this.getHangingTasks().length
    };
  }

  /**
   * Clear completed/failed tasks older than age
   */
  clearOld(age = 3600000) { // 1 hour default
    const cutoff = Date.now() - age;
    
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running') {
        const endedAt = task.completedAt || task.failedAt;
        if (endedAt && endedAt < cutoff) {
          this.tasks.delete(id);
        }
      }
    }
  }
}

module.exports = { TaskMonitor };
