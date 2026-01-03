import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import 'shared/custom-els/loading-spinner';

const bulkCompressPromise = import('client/lazy-app/BulkCompress');
const swBridgePromise = import('client/lazy-app/sw-bridge');

function goHome() {
  window.location.href = '/';
}

interface Props { }

interface State {
  awaitingShareTarget: boolean;
  BulkCompress?: typeof import('client/lazy-app/BulkCompress').default;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    BulkCompress: undefined,
  };

  snackbar?: SnackBarElement;

  constructor() {
    super();

    bulkCompressPromise
      .then((module) => {
        this.setState({ BulkCompress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load app');
      });

    swBridgePromise.then(async ({ offliner }) => {
      offliner(this.showSnack);
    });

    // Since iOS 10, Apple tries to prevent disabling pinch-zoom.
    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });
  }

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  render(
    { }: Props,
    {
      BulkCompress,
      awaitingShareTarget,
    }: State,
  ) {
    const showSpinner = awaitingShareTarget || !BulkCompress;

    return (
      <div class={style.app}>
        <file-drop class={style.drop}>
          {showSpinner ? (
            <loading-spinner class={style.appLoader} />
          ) : (
            BulkCompress && (
              <BulkCompress
                showSnack={this.showSnack}
                onBack={goHome}
              />
            )
          )}
          <snack-bar ref={linkRef(this, 'snackbar')} />
        </file-drop>
      </div>
    );
  }
}
