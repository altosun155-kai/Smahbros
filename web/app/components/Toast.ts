// Toast — re-exports the existing imperative showToast() from lib/api.ts.
// showToast already owns a singleton #toast-container appended to
// document.body; a React-rendered toast component here would just create a
// second, competing container. Import from here (not lib/api directly) so
// Phase-2 pages have one obvious "the toast component" to reach for, same
// spirit as Button/Card/Modal.
export { showToast } from '../lib/api';
