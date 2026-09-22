// Options applied to every v2 function. Must be imported before any module that
// defines a function (index.ts does it on its first line): v2 functions read the
// global options at the moment they are defined, not when they run.

import { setGlobalOptions } from 'firebase-functions/v2';
import { ALL_SECRETS } from './utils/secrets';

setGlobalOptions({ secrets: ALL_SECRETS });
