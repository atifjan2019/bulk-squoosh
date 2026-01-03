
import { h, Component, Fragment } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import WorkerBridge from 'client/lazy-app/worker-bridge';
import {
    builtinDecode,
} from 'client/lazy-app/util';
import {
    encoderMap,
    EncoderType,
} from 'client/lazy-app/feature-meta';
import { WorkerResizeOptions } from 'features/processors/resize/shared/meta';

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
    outputName?: string;
}

interface State {
    processedFiles: ProcessedFile[];
    processing: boolean;
    selectedFormat: EncoderType;
    quality: number;
    resize: {
        enabled: boolean;
        width: number;
        height: number;
        maintainAspectRatio: boolean;
        scale: number; // percentage 1-100
        mode: 'dimensions' | 'scale';
    };
    output: {
        prefix: string;
        suffix: string;
    };
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
    private fileListRef: HTMLDivElement | null = null;

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
            resize: {
                enabled: false,
                width: 1920,
                height: 1080,
                maintainAspectRatio: true,
                scale: 100,
                mode: 'scale',
            },
            output: {
                prefix: '',
                suffix: '',
            },
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

        const { processedFiles, selectedFormat, quality, resize, output } = this.state;

        for (let i = 0; i < processedFiles.length; i++) {
            const fileData = processedFiles[i];
            if (fileData.status !== 'pending') continue;

            this.updateFileStatus(i, 'processing');

            try {
                const file = fileData.original;
                const result = await this.compressFile(file, selectedFormat, quality, resize);

                // Generate output name
                const ext = encoderMap[selectedFormat].meta.mimeType.split('/')[1];
                const originalName = file.name.replace(/\.[^/.]+$/, "");
                const outputName = `${output.prefix}${originalName}${output.suffix}.${ext}`;

                this.setState(prevState => {
                    const newFiles = [...prevState.processedFiles];
                    newFiles[i] = {
                        ...newFiles[i],
                        status: 'done',
                        resultBlob: result,
                        resultUrl: URL.createObjectURL(result),
                        resultSize: result.size,
                        outputName,
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

    async compressFile(
        file: File,
        format: EncoderType,
        quality: number,
        resizeSettings: State['resize']
    ): Promise<Blob> {
        const signal = new AbortController().signal;
        let decoded: ImageData;

        try {
            decoded = await builtinDecode(signal, file);
        } catch (e) {
            throw new Error('Could not decode image');
        }

        // Apply Resize if enabled
        if (resizeSettings.enabled) {
            let targetWidth = decoded.width;
            let targetHeight = decoded.height;

            if (resizeSettings.mode === 'scale') {
                const ratio = resizeSettings.scale / 100;
                targetWidth = Math.round(decoded.width * ratio);
                targetHeight = Math.round(decoded.height * ratio);
            } else {
                // Dimensions mode
                if (resizeSettings.maintainAspectRatio) {
                    const aspect = decoded.width / decoded.height;
                    if (resizeSettings.width / resizeSettings.height > aspect) {
                        // Height is limiting factor
                        targetHeight = resizeSettings.height;
                        targetWidth = Math.round(targetHeight * aspect);
                    } else {
                        // Width is limiting factor
                        targetWidth = resizeSettings.width;
                        targetHeight = Math.round(targetWidth / aspect);
                    }
                } else {
                    targetWidth = resizeSettings.width;
                    targetHeight = resizeSettings.height;
                }
            }

            // Ensure at least 1px
            targetWidth = Math.max(1, targetWidth);
            targetHeight = Math.max(1, targetHeight);

            const options: WorkerResizeOptions = {
                width: targetWidth,
                height: targetHeight,
                method: 'lanczos3',
                fitMethod: 'stretch',
                premultiply: true,
                linearRGB: true,
            };

            decoded = await this.workerBridge.resize(signal, decoded, options);
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

    onResizeEnableChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            resize: { ...prev.resize, enabled: target.checked }
        }));
    }

    onResizeModeChange = (mode: 'scale' | 'dimensions') => {
        this.setState(prev => ({
            resize: { ...prev.resize, mode }
        }));
    }

    onResizeScaleChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            resize: { ...prev.resize, scale: parseInt(target.value, 10) }
        }));
    }

    onResizeWidthChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            resize: { ...prev.resize, width: parseInt(target.value, 10) }
        }));
    }

    onResizeHeightChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            resize: { ...prev.resize, height: parseInt(target.value, 10) }
        }));
    }

    onPrefixChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            output: { ...prev.output, prefix: target.value }
        }));
    }

    onSuffixChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        this.setState(prev => ({
            output: { ...prev.output, suffix: target.value }
        }));
    }

    clearAll = () => {
        this.state.processedFiles.forEach(f => {
            if (f.resultUrl) URL.revokeObjectURL(f.resultUrl);
        });
        this.setState({ processedFiles: [], processing: false });
    }

    downloadAll = () => {
        this.state.processedFiles.forEach(file => {
            if (file.status === 'done' && file.resultUrl && file.outputName) {
                const a = document.createElement('a');
                a.href = file.resultUrl;
                a.download = file.outputName;
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

    render({ onBack }: Props, { processedFiles, processing, selectedFormat, quality, resize, output }: State) {
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
                    <div class={style.mainLayout}>
                        {/* Left Sidebar - Settings */}
                        <div class={style.sidebar}>
                            {/* Conversion Settings */}
                            <div class={style.card}>
                                <h3 class={style.cardTitle}>Compression</h3>
                                <div class={style.settingGroup}>
                                    <label class={style.settingLabel}>Format</label>
                                    <select
                                        class={style.input}
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
                                    <label class={style.settingLabel}>
                                        Quality: {quality}%
                                    </label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="100"
                                        value={quality}
                                        onInput={this.onQualityChange}
                                        class={style.slider}
                                        disabled={processing}
                                    />
                                </div>
                            </div>

                            {/* Resize Settings */}
                            <div class={style.card}>
                                <div class={style.cardHeader}>
                                    <h3 class={style.cardTitle}>Resize</h3>
                                    <label class={style.toggle}>
                                        <input
                                            type="checkbox"
                                            checked={resize.enabled}
                                            onChange={this.onResizeEnableChange}
                                            disabled={processing}
                                        />
                                        <span class={style.toggleSlider}></span>
                                    </label>
                                </div>

                                {resize.enabled && (
                                    <div class={style.cardBody}>
                                        <div class={style.tabGroup}>
                                            <button
                                                class={`${style.tab} ${resize.mode === 'scale' ? style.activeTab : ''}`}
                                                onClick={() => this.onResizeModeChange('scale')}
                                                disabled={processing}
                                            >
                                                Percentage
                                            </button>
                                            <button
                                                class={`${style.tab} ${resize.mode === 'dimensions' ? style.activeTab : ''}`}
                                                onClick={() => this.onResizeModeChange('dimensions')}
                                                disabled={processing}
                                            >
                                                Fixed Size
                                            </button>
                                        </div>

                                        {resize.mode === 'scale' ? (
                                            <div class={style.settingGroup}>
                                                <label class={style.settingLabel}>Scale: {resize.scale}%</label>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="200"
                                                    value={resize.scale}
                                                    onInput={this.onResizeScaleChange}
                                                    class={style.slider}
                                                    disabled={processing}
                                                />
                                            </div>
                                        ) : (
                                            <div class={style.dimensionsGrid}>
                                                <div class={style.settingGroup}>
                                                    <label class={style.settingLabel}>Width</label>
                                                    <input
                                                        type="number"
                                                        value={resize.width}
                                                        onInput={this.onResizeWidthChange}
                                                        class={style.input}
                                                        disabled={processing}
                                                    />
                                                </div>
                                                <div class={style.settingGroup}>
                                                    <label class={style.settingLabel}>Height</label>
                                                    <input
                                                        type="number"
                                                        value={resize.height}
                                                        onInput={this.onResizeHeightChange}
                                                        class={style.input}
                                                        disabled={processing}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Output Settings */}
                            <div class={style.card}>
                                <h3 class={style.cardTitle}>Output Name</h3>
                                <div class={style.dimensionsGrid}>
                                    <div class={style.settingGroup}>
                                        <label class={style.settingLabel}>Prefix</label>
                                        <input
                                            type="text"
                                            placeholder="img-"
                                            value={output.prefix}
                                            onInput={this.onPrefixChange}
                                            class={style.input}
                                            disabled={processing}
                                        />
                                    </div>
                                    <div class={style.settingGroup}>
                                        <label class={style.settingLabel}>Suffix</label>
                                        <input
                                            type="text"
                                            placeholder="-opt"
                                            value={output.suffix}
                                            onInput={this.onSuffixChange}
                                            class={style.input}
                                            disabled={processing}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Content - File List */}
                        <div class={style.mainContent}>
                            <div class={style.toolbar}>
                                <div class={style.stats}>
                                    <div class={style.statItem}>
                                        <strong>{processedFiles.length}</strong> Files
                                    </div>
                                    <div class={style.statItem}>
                                        <strong>{completedCount}</strong> Done
                                    </div>
                                    {totalSaved > 0 && (
                                        <div class={`${style.statItem} ${style.savedStat}`}>
                                            Saved <strong>{(totalSaved / 1024 / 1024).toFixed(2)} MB</strong>
                                        </div>
                                    )}
                                </div>
                                <div class={style.actions}>
                                    <button class={style.primaryBtn} onClick={this.openFilePicker} disabled={processing}>
                                        + Add Images
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
                                        <div class={style.actions}>
                                            <button class={style.secondaryBtn} onClick={this.downloadAll} disabled={processing || completedCount === 0}>
                                                Download All
                                            </button>
                                            <button class={style.dangerBtn} onClick={this.clearAll} disabled={processing}>
                                                Clear
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* File List Area */}
                            <div class={style.fileListContainer} ref={el => this.fileListRef = el}>
                                {!hasFiles ? (
                                    <div class={style.emptyState}>
                                        <div class={style.emptyIconWrapper}>
                                            <svg viewBox="0 0 24 24" class={style.emptyIcon}>
                                                <path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z" />
                                            </svg>
                                        </div>
                                        <h2>Drop images here</h2>
                                        <p>or click "Add Images" to start</p>
                                    </div>
                                ) : (
                                    <ul class={style.fileList}>
                                        {processedFiles.map((file, index) => (
                                            <li class={style.fileItem} key={index}>
                                                <div class={style.filePreview}>
                                                    {file.status === 'done' ? (
                                                        <img src={file.resultUrl} />
                                                    ) : (
                                                        <div class={style.fileIcon}>IMG</div>
                                                    )}
                                                </div>
                                                <div class={style.fileInfo}>
                                                    <div class={style.fileName} title={file.original.name}>{file.original.name}</div>
                                                    <div class={style.fileMeta}>
                                                        {(file.original.size / 1024).toFixed(1)} KB
                                                        {file.status === 'done' && file.resultSize && (
                                                            <Fragment>
                                                                <span class={style.arrow}> → </span>
                                                                <span class={style.compressedSize}>
                                                                    {(file.resultSize / 1024).toFixed(1)} KB
                                                                </span>
                                                                <span class={style.savingsTag}>
                                                                    -{Math.round((1 - file.resultSize! / file.original.size) * 100)}%
                                                                </span>
                                                            </Fragment>
                                                        )}
                                                    </div>
                                                </div>
                                                <div class={style.fileStatus}>
                                                    {file.status === 'pending' && <span class={style.badge}>Waiting</span>}
                                                    {file.status === 'processing' && (
                                                        <span class={`${style.badge} ${style.badgeProcessing}`}>
                                                            Processing...
                                                        </span>
                                                    )}
                                                    {file.status === 'error' && <span class={`${style.badge} ${style.badgeError}`}>Error</span>}
                                                    {file.status === 'done' && (
                                                        <a
                                                            href={file.resultUrl}
                                                            download={file.outputName}
                                                            class={style.iconBtn}
                                                            title="Download"
                                                        >
                                                            <svg viewBox="0 0 24 24">
                                                                <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                                                            </svg>
                                                        </a>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
