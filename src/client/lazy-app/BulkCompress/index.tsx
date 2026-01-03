
import { h, Component } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';

interface Props {
    files: File[];
    showSnack: SnackBarElement['showSnackbar'];
    onBack: () => void;
}

interface State {
}

export default class BulkCompress extends Component<Props, State> {
    componentDidMount() {
        // Just for debugging
        console.log('BulkCompress mounted with files:', this.props.files);
    }

    render({ files, onBack }: Props) {
        return (
            <div class={style.bulkCompress}>
                <div class={style.header}>
                    <button class={style.back} onClick={onBack}>
                        <svg viewBox="-50 -50 200 200">
                            <path
                                d="M34.6 83.4c-9.5 7.1-23.8 6.5-32-2.9-7-8.1-6.1-20.7 2.1-28.9L49.6 4.7C59.1-2.4 73.4-1.8 81.6 7.6c7 8.1 6.1 20.7-2.1 28.9L34.6 83.4z"
                                class={style.backBlob}
                                transform="rotate(-45 50 50)"
                            />
                            <path
                                d="M24 24 L76 76 M76 24 L24 76"
                                stroke="white"
                                stroke-width="8"
                                stroke-linecap="round"
                                class={style.backX}
                            />
                        </svg>
                    </button>
                    <h1>Bulk Squoosh</h1>
                </div>
                <div class={style.content}>
                    <h2>Files selected: {files.length}</h2>
                    <ul>
                        {files.map(file => (
                            <li>{file.name} - {(file.size / 1024).toFixed(2)} KB</li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    }
}
