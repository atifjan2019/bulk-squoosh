
import { h, Component } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import WorkerBridge from 'client/lazy-app/worker-bridge';
import {
    base64ToBlob,
    blobToImg,
    builtinDecode,
    sniffMimeType,
    canDecodeImageType,
} from 'client/lazy-app/util';
import {
    encoderMap,
    EncoderState,
    defaultProcessorState,
    defaultPreprocessorState,
    EncoderType,
} from 'client/lazy-app/feature-meta';
import { drawableToImageData } from 'client/lazy-app/util/canvas';

interface Props {
    files: File[];
    showSnack: SnackBarElement['showSnackbar'];
    onBack: () => void;
}

interface ProcessedFile {
    original: File;
    status: 'pending' | 'processing' | 'done' | 'error';
    resultBlob?: Blob;
    resultUrl?: string;
    resultSize?: number;
    error?: string;
}

interface State {
    processedFiles: ProcessedFile[];
    processing: boolean;
}

export default class BulkCompress extends Component<Props, State> {
    private workerBridge = new WorkerBridge();

    constructor(props: Props) {
        super(props);
        this.state = {
            processedFiles: props.files.map(f => ({
                original: f,
                status: 'pending'
            })),
            processing: false
        };
    }

    componentDidMount() {
        this.processFiles();
    }

    async processFiles() {
        this.setState({ processing: true });
        const { processedFiles } = this.state;

        // Process sequentially for now to be safe
        for (let i = 0; i < processedFiles.length; i++) {
            const fileData = processedFiles[i];
            if (fileData.status !== 'pending') continue;

            this.updateFileStatus(i, 'processing');

            try {
                const file = fileData.original;
                const result = await this.compressFile(file);

                this.setState(prevState => {
                    const newFiles = [...prevState.processedFiles];
                    newFiles[i] = {
                        ...newFiles[i],
                        status: 'done',
                        resultBlob: result,
                        resultUrl: URL.createObjectURL(result),
                        resultSize: result.size
                    };
                    return { processedFiles: newFiles };
                });
            } catch (e) {
                console.error(e);
                this.setState(prevState => {
                    const newFiles = [...prevState.processedFiles];
                    newFiles[i] = {
                        ...newFiles[i],
                        status: 'error',
                        error: String(e)
                    };
                    return { processedFiles: newFiles };
                });
            }
        }
        this.setState({ processing: false });
    }

    updateFileStatus(index: number, status: ProcessedFile['status']) {
        this.setState(prevState => {
            const newFiles = [...prevState.processedFiles];
            newFiles[index] = { ...newFiles[index], status };
            return { processedFiles: newFiles };
        });
    }

    async compressFile(file: File): Promise<Blob> {
        // 1. Decode
        // Simple decoding for now, similar to Compress/index.tsx but simplified
        const mimeType = await sniffMimeType(file);
        // We assume it's decodable by browser for now for simplicity, 
        // or fall back to builtinDecode which handles some cases.
        // Ideally we'd copy the robust decoding logic from Compress/index.tsx

        const signal = new AbortController().signal; // Dummy signal
        let decoded: ImageData;

        // Try built-in decode first
        try {
            decoded = await builtinDecode(signal, file);
        } catch (e) {
            // If built-in fails, try worker decoders if needed, but let's stick to basic Support first
            throw new Error('Could not decode image');
        }

        // 2. Preprocess (Identity for now)
        // We can add resizing options later if user requests

        // 3. Compress
        // Default to MozJPEG for now, or ensure we pick a good default based on input?
        // Let's rely on MozJPEG as a safe default for opaque, OxiPNG for transparent?
        // Checking alpha channel is expensive without analyzing image data, so let's default to MozJPEG for now.

        const encoderState: EncoderState = {
            type: 'mozJPEG',
            options: encoderMap.mozJPEG.meta.defaultOptions,
        };

        const encoder = encoderMap[encoderState.type];
        const compressedData = await encoder.encode(
            signal,
            this.workerBridge,
            decoded,
            encoderState.options as any
        );

        return new Blob([compressedData], { type: encoder.meta.mimeType });
    }

    async downloadAll() {
        // Implement zip download later if needed
        // For now just alert or something
    }

    render({ onBack }: Props, { processedFiles, processing }: State) {
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
                    <div class={style.status}>
                        {processing ? 'Processing...' : 'Done'}
                    </div>

                    <ul class={style.fileList}>
                        {processedFiles.map(file => (
                            <li class={style.fileItem}>
                                <div class={style.fileInfo}>
                                    <div>{file.original.name}</div>
                                    <div class={style.fileMeta}>
                                        Original: {(file.original.size / 1024).toFixed(2)} KB
                                    </div>
                                </div>
                                <div class={style.fileStatus}>
                                    {file.status === 'pending' && '⏳'}
                                    {file.status === 'processing' && '⚙️'}
                                    {file.status === 'error' && '❌ ' + file.error}
                                    {file.status === 'done' && (
                                        <div class={style.resultInfo}>
                                            <span>{(file.resultSize! / 1024).toFixed(2)} KB</span>
                                            <span class={style.savings}>
                                                ({Math.round((1 - file.resultSize! / file.original.size) * 100)}% saved)
                                            </span>
                                            <a href={file.resultUrl} download={`squooshed-${file.original.name.replace(/\.[^/.]+$/, "")}.jpg`} class={style.downloadBtn}>⬇️</a>
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    }
}
