# FileQueue API Reference

## Class: FileQueue

### Constructor
```javascript
const queue = new FileQueue(name, basePath);
```

**Parameters:**
- `name` (string): Queue name
- `basePath` (string): Directory for queue files (default: '/knowledge-system/queues')

### Methods

#### push(message)
Append message to queue with WAL durability.

**Returns:** Promise<string> - Message ID

#### pop()
Remove and return first message.

**Returns:** Promise<object|null> - Message or null if empty

#### peek()
View first message without removing.

**Returns:** Promise<object|null>

#### recover()
Replay WAL to restore state after crash.

**Returns:** Promise<{recovered: number}>

#### length()
Get queue size.

**Returns:** Promise<number>

## File Structure

```
basePath/
  {name}.jsonl      — Main queue (append-only)
  {name}.wal        — Write-ahead log
  {name}.processing — In-progress messages
```

## Durability Guarantees

1. **Atomic append:** Messages written to WAL before queue
2. **Crash recovery:** WAL replayed on recover()
3. **No duplicates:** Message IDs checked during recovery

## Example

```javascript
const { FileQueue } = require('./file-queue');

async function main() {
  const queue = new FileQueue('tasks');
  
  // Producer
  await queue.push({ task: 'process', data: 'file.txt' });
  
  // Consumer
  const task = await queue.pop();
  if (task) {
    console.log('Processing:', task.data);
  }
  
  // Recover after crash
  await queue.recover();
}
```
