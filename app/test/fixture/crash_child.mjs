// Child process for the hygiene test: installs the real process guards, throws and rejects, then proves it is alive.
import { pathToFileURL } from 'node:url';
const [serverPath, logFile] = process.argv.slice(2);
if (!serverPath || !logFile) process.exit(0); // picked up by a bare `node --test`: nothing to do
const { installProcessGuards } = await import(pathToFileURL(serverPath).href);
installProcessGuards(logFile);
setTimeout(() => { throw new Error('planted crash'); }, 10);
setTimeout(() => { Promise.reject(new Error('planted rejection')); }, 20);
setTimeout(() => { console.log('ALIVE AFTER THROW'); process.exit(0); }, 300);
