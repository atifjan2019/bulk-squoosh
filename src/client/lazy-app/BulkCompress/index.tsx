
import { h, Component } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import WorkerBridge from 'client/lazy-app/worker-bridge';
import {
    builtinDecode,
} from 'client/lazy-app/util';
import {
    encoderMap,
    EncoderState,
    EncoderType,
} from 'client/lazy-app/feature-meta';

interface Props {
    files?: File[];
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
    selectedFormat: EncoderType;
    quality: number;
}

const formatOptions: { value: EncoderType; label: string }[] = [
    { value: 'mozJPEG', label: 'MozJPEG' },
    { value: 'webP', label: 'WebP' },
    { value: 'avif', label: 'AVIF' },
    { value: 'oxiPNG', label: 'OxiPNG' },
    { value: 'jxl', label: 'JPEG XL' },
];

export default class BulkCompress extends Component<Props, State> {
    private workerBridge = new WorkerBridge();
    private fileInput: HTMLInputElement | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            processedFiles: props.files ? props.files.map(f => ({
                original: f,
                status: 'pending'
            })) : [],
            processing: false,
            selectedFormat: 'mozJPEG',
            quality: 75,
        };
    }

    componentDidMount() {
        if (this.state.processedFiles.length > 0) {
            this.processFiles();
        }
    }

    async processFiles() {
        if (this.state.processing) return;
        this.setState({ processing: true });

        const { processedFiles, selectedFormat, quality } = this.state;

        for (let i = 0; i < processedFiles.length; i++) {
            const fileData = processedFiles[i];
            if (fileData.status !== 'pending') continue;

            this.updateFileStatus(i, 'processing');

            try {
                const file = fileData.original;
                const result = await this.compressFile(file, selectedFormat, quality);

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

    openFilePicker = () => {
        if (this.fileInput) {
            this.fileInput.click();
        }
    }

    onFileChange = (e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const newFiles = Array.from(input.files).map(f => ({
                original: f,
                status: 'pending' as const
            }));

            this.setState(prevState => ({
                processedFiles: [...prevState.processedFiles, ...newFiles]
            }), () => {
                this.processFiles();
            });
        }
        input.value = '';
    }

    updateFileStatus(index: number, status: ProcessedFile['status']) {
        this.setState(prevState => {
            const newFiles = [...prevState.processedFiles];
            newFiles[index] = { ...newFiles[index], status };
            return { processedFiles: newFiles };
        });
    }

    async compressFile(file: File, format: EncoderType, quality: number): Promise<Blob> {
        const signal = new AbortController().signal;
        let decoded: ImageData;

        try {
            decoded = await builtinDecode(signal, file);
        } catch (e) {
            throw new Error('Could not decode image');
        }

        const encoder = encoderMap[format];
        const options = { ...encoder.meta.defaultOptions };

        // Apply quality setting where applicable
        if ('quality' in options) {
            (options as any).quality = quality;
        }

        const compressedData = await encoder.encode(
            signal,
            this.workerBridge,
            decoded,
            options as any
        );

        return new Blob([compressedData], { type: encoder.meta.mimeType });
    }

    onFormatChange = (e: Event) => {
        const target = e.target as HTMLSelectElement;
        this.setState({ selectedFormat: target.value as EncoderType });
    }

    onQualityChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState({ quality: parseInt(target.value, 10) });
    }

    clearAll = () => {
        this.state.processedFiles.forEach(f => {
            if (f.resultUrl) URL.revokeObjectURL(f.resultUrl);
        });
        this.setState({ processedFiles: [], processing: false });
    }

    downloadAll = () => {
        this.state.processedFiles.forEach(file => {
            if (file.status === 'done' && file.resultUrl) {
                const a = document.createElement('a');
                a.href = file.resultUrl;
                const ext = encoderMap[this.state.selectedFormat].meta.mimeType.split('/')[1];
                a.download = `squooshed-${file.original.name.replace(/\.[^/.]+$/, "")}.${ext}`;
                a.click();
            }
        });
    }

    getCompletedCount() {
        return this.state.processedFiles.filter(f => f.status === 'done').length;
    }

    getTotalSaved() {
        return this.state.processedFiles.reduce((acc, f) => {
            if (f.status === 'done' && f.resultSize) {
                return acc + (f.original.size - f.resultSize);
            }
            return acc;
        }, 0);
    }

    render({ onBack }: Props, { processedFiles, processing, selectedFormat, quality }: State) {
        const completedCount = this.getCompletedCount();
        const totalSaved = this.getTotalSaved();
        const hasFiles = processedFiles.length > 0;

        return (
            <div class={style.bulkCompress}>
                <div class={style.header}>
                    <button class={style.back} onClick={onBack}>
                        <svg viewBox="0 0 24 24">
                            <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                        </svg>
                    </button>
                    <h1>Bulk Squoosh</h1>
                </div>

                <div class={style.content}>
                    {/* Settings Panel */}
                    <div class={style.settingsPanel}>
                        <div class={style.settingsRow}>
                            <div class={style.settingGroup}>
                                <label class={style.settingLabel}>Output Format</label>
                                <select
                                    class={style.formatSelect}
                                    value={selectedFormat}
                                    onChange={this.onFormatChange}
                                    disabled={processing}
                                >
                                    {formatOptions.map(opt => (
                                        <option value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div class={style.settingGroup}>
                                <label class={style.settingLabel}>Quality: {quality}%</label>
                                <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    value={quality}
                                    onInput={this.onQualityChange}
                                    class={style.qualitySlider}
                                    disabled={processing}
                                />
                            </div>
                        </div>

                        <div class={style.actionButtons}>
                            <button class={style.primaryBtn} onClick={this.openFilePicker} disabled={processing}>
                                <svg viewBox="0 0 24 24" class={style.btnIcon}>
                                    <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                                </svg>
                                Add Images
                            </button>
                            <input
                                type="file"
                                multiple
                                accept="image/*"
                                ref={el => this.fileInput = el}
                                onChange={this.onFileChange}
                                style={{ display: 'none' }}
                            />
                            {hasFiles && (
                                <div class={style.actionButtons}>
                                    <button class={style.secondaryBtn} onClick={this.downloadAll} disabled={processing || completedCount === 0}>
                                        <svg viewBox="0 0 24 24" class={style.btnIcon}>
                                            <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                                        </svg>
                                        Download All
                                    </button>
                                    <button class={style.dangerBtn} onClick={this.clearAll} disabled={processing}>
                                        Clear All
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stats */}
                    {hasFiles && (
                        <div class={style.statsBar}>
                            <div class={style.stat}>
                                <span class={style.statValue}>{processedFiles.length}</span>
                                <span class={style.statLabel}>Total</span>
                            </div>
                            <div class={style.stat}>
                                <span class={style.statValue}>{completedCount}</span>
                                <span class={style.statLabel}>Completed</span>
                            </div>
                            <div class={style.stat}>
                                <span class={`${style.statValue} ${style.savedValue}`}>
                                    {totalSaved > 0 ? `${(totalSaved / 1024).toFixed(1)} KB` : '—'}
                                </span>
                                <span class={style.statLabel}>Saved</span>
                            </div>
                            {processing && (
                                <div class={style.processingIndicator}>
                                    <div class={style.spinner}></div>
                                    Processing...
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty State */}
                    {!hasFiles && (
                        <div class={style.emptyState}>
                            <svg viewBox="0 0 24 24" class={style.emptyIcon}>
                                <path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z" />
                            </svg>
                            <h2>No images yet</h2>
                            <p>Click "Add Images" to start compressing</p>
                        </div>
                    )}

                    {/* File List */}
                    {hasFiles && (
                        <ul class={style.fileList}>
                            {processedFiles.map((file, index) => (
                                <li class={style.fileItem} key={index}>
                                    <div class={style.fileInfo}>
                                        <div class={style.fileName}>{file.original.name}</div>
                                        <div class={style.fileMeta}>
                                            Original: {(file.original.size / 1024).toFixed(1)} KB
                                            {file.status === 'done' && file.resultSize && (
                                                <span class={style.arrow}> → </span>
                                            )}
                                            {file.status === 'done' && file.resultSize && (
                                                <span class={style.compressedSize}>
                                                    {(file.resultSize / 1024).toFixed(1)} KB
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div class={style.fileStatus}>
                                        {file.status === 'pending' && (
                                            <span class={style.statusPending}>Waiting</span>
                                        )}
                                        {file.status === 'processing' && (
                                            <span class={style.statusProcessing}>
                                                <div class={style.spinnerSmall}></div>
                                            </span>
                                        )}
                                        {file.status === 'error' && (
                                            <span class={style.statusError}>Failed</span>
                                        )}
                                        {file.status === 'done' && (
                                            <div class={style.doneActions}>
                                                <span class={style.savings}>
                                                    {Math.round((1 - file.resultSize! / file.original.size) * 100)}% saved
                                                </span>
                                                <a
                                                    href={file.resultUrl}
                                                    download={`squooshed-${file.original.name.replace(/\.[^/.]+$/, "")}.${encoderMap[selectedFormat].meta.mimeType.split('/')[1]}`}
                                                    class={style.downloadBtn}
                                                >
                                                    <svg viewBox="0 0 24 24">
                                                        <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                                                    </svg>
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        );
    }
}
