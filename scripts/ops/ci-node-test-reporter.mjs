import { appendFileSync } from 'node:fs';
import { Transform } from 'node:stream';

export default function ciNodeTestReporter() {
  const failLog = process.env.CI_NODE_TEST_FAIL_LOG;
  return new Transform({
    writableObjectMode: true,
    transform(event, _encoding, callback) {
      if (event?.type === 'test:fail' && failLog && event.data?.file) {
        appendFileSync(failLog, `${JSON.stringify({ file: event.data.file })}\n`);
      }
      callback();
    },
  });
}
