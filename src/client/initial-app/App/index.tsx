import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import Intro from 'shared/prerendered-app/Intro';
import 'shared/custom-els/loading-spinner';

const ROUTE_EDITOR = '/editor';
const ROUTE_BULK = '/bulk';

const compressPromise = import('client/lazy-app/Compress');
const bulkCompressPromise = import('client/lazy-app/BulkCompress');
const swBridgePromise = import('client/lazy-app/sw-bridge');

function back() {
  window.history.back();
}

interface Props { }

interface State {
  awaitingShareTarget: boolean;
  file?: File;
  files?: File[];
  isEditorOpen: Boolean;
  isBulkOpen: Boolean;
  Compress?: typeof import('client/lazy-app/Compress').default;
  BulkCompress?: typeof import('client/lazy-app/BulkCompress').default;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    isEditorOpen: false,
    isBulkOpen: false,
    file: undefined,
    files: undefined,
    Compress: undefined,
    BulkCompress: undefined,
  };

  snackbar?: SnackBarElement;

  constructor() {
    super();

    compressPromise
      .then((module) => {
        this.setState({ Compress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load app');
      });

    bulkCompressPromise
      .then((module) => {
        this.setState({ BulkCompress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load bulk app');
      });

    swBridgePromise.then(async ({ offliner, getSharedImage }) => {
      offliner(this.showSnack);
      if (!this.state.awaitingShareTarget) return;
      const file = await getSharedImage();
      // Remove the ?share-target from the URL
      history.replaceState('', '', '/');
      this.openEditor();
      this.setState({ file, awaitingShareTarget: false });
    });

    // Since iOS 10, Apple tries to prevent disabling pinch-zoom. This is great in theory, but
    // really breaks things on Squoosh, as you can easily end up zooming the UI when you mean to
    // zoom the image. Once you've done this, it's really difficult to undo. Anyway, this seems to
    // prevent it.
    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', this.onPopState);
  }

  private onFileDrop = ({ files }: FileDropEvent) => {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      const file = files[0];
      this.openEditor();
      this.setState({ file, files: undefined });
    } else {
      this.openBulkEditor();
      this.setState({ files: Array.from(files), file: undefined });
    }
  };

  private onIntroPickFile = (file: File | File[]) => {
    if (Array.isArray(file)) {
      this.openBulkEditor();
      this.setState({ files: file, file: undefined });
    } else {
      this.openEditor();
      this.setState({ file, files: undefined });
    }
  };

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  private onPopState = () => {
    this.setState({
      isEditorOpen: location.pathname === ROUTE_EDITOR,
      isBulkOpen: location.pathname === ROUTE_BULK,
    });
  };

  private openEditor = () => {
    if (this.state.isEditorOpen) return;
    // Change path, but preserve query string.
    const editorURL = new URL(location.href);
    editorURL.pathname = ROUTE_EDITOR;
    history.pushState(null, '', editorURL.href);
    this.setState({ isEditorOpen: true, isBulkOpen: false });
  };

  private openBulkEditor = () => {
    if (this.state.isBulkOpen) return;
    const bulkURL = new URL(location.href);
    bulkURL.pathname = ROUTE_BULK;
    history.pushState(null, '', bulkURL.href);
    this.setState({ isBulkOpen: true, isEditorOpen: false });
  };

  render(
    { }: Props,
    {
      file,
      files,
      isEditorOpen,
      isBulkOpen,
      Compress,
      BulkCompress,
      awaitingShareTarget,
    }: State,
  ) {
    const showSpinner =
      awaitingShareTarget ||
      (isEditorOpen && !Compress) ||
      (isBulkOpen && !BulkCompress);

    return (
      <div class={style.app}>
        <file-drop onfiledrop={this.onFileDrop} class={style.drop}>
          {showSpinner ? (
            <loading-spinner class={style.appLoader} />
          ) : isEditorOpen ? (
            Compress && (
              <Compress file={file!} showSnack={this.showSnack} onBack={back} />
            )
          ) : isBulkOpen ? (
            BulkCompress && (
              <BulkCompress
                files={files!}
                showSnack={this.showSnack}
                onBack={back}
              />
            )
          ) : (
            <Intro onFile={this.onIntroPickFile} showSnack={this.showSnack} />
          )}
          <snack-bar ref={linkRef(this, 'snackbar')} />
        </file-drop>
      </div>
    );
  }
}
