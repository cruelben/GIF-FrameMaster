/* ============================================================
   GIF FRAME MASTER
   app.js - versione completa
   ============================================================ */


/* ============================================================
   VARIABILI GLOBALI
   ============================================================ */

let originalFrames = [];
let composedFrames = [];

let selectedFrames = new Set();

let gifWidth = 0;
let gifHeight = 0;

let cropRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};

let cropInteraction = null;

let cropPreviewOverrideIndex = null;

let currentExportData = null;

let speedMultiplier = 1;

let undoStack = [];

const UNDO_LIMIT = 20;


/* ============================================================
   FUNZIONE DI SUPPORTO DOM
   Evita errori se un elemento non esiste nell'HTML.
   ============================================================ */

function $(id) {
    return document.getElementById(id);
}


/* ============================================================
   RIFERIMENTI ELEMENTI HTML
   ============================================================ */

const fileInput = $("gif-file");
const loading = $("loading");
const workspace = $("workspace");
const cropWorkspace = $("crop-workspace");
const exportWorkspace = $("export-workspace");

const framesGrid = $("frames-grid");
const frameCount = $("frame-count");
const gifDimensions = $("gif-dimensions");

const cropCanvas = $("crop-canvas");
const cropContainer = $("crop-container");
const cropSelection = $("crop-selection");

const cropX = $("crop-x");
const cropY = $("crop-y");
const cropWidth = $("crop-width");
const cropHeight = $("crop-height");

const exportStatus = $("export-status");
const exportPreview = $("export-preview");
const exportSummary = $("export-summary");


/* ============================================================
   CONTROLLO ELEMENTI PRINCIPALI
   ============================================================ */

if (!fileInput) {

    console.error(
        "GIF Frame Master: elemento #gif-file non trovato."
    );
}

if (!framesGrid) {

    console.error(
        "GIF Frame Master: elemento #frames-grid non trovato."
    );
}


/* ============================================================
   GESTIONE UNDO (ANNULLA ULTIMA AZIONE)
   ============================================================

   Salviamo uno "snapshot" leggero prima di ogni azione che
   modifica la selezione o l'elenco dei fotogrammi.

   Uno snapshot contiene:
     - la lista dei fotogrammi (composedFrames)
     - l'insieme dei fotogrammi selezionati (selectedFrames)

   Non copriamo crop e velocità: hanno già un proprio
   pulsante di ripristino dedicato.
   ============================================================ */

function pushUndoSnapshot() {

    undoStack.push({

        composedFrames:
            composedFrames.slice(),

        selectedFrames:
            new Set(selectedFrames)
    });


    if (undoStack.length > UNDO_LIMIT) {

        undoStack.shift();
    }
}

function undoLastAction() {

    if (undoStack.length === 0) {

        return;
    }


    const snapshot =
        undoStack.pop();


    composedFrames =
        snapshot.composedFrames;

    selectedFrames =
        snapshot.selectedFrames;

    lastSelectedFrameIndex = null;


    renderFramesGrid();

    updateFrameCount();

    updateCropPreview();

    updateSpeedPreview();
}

const undoButton = $("undo-action");

if (undoButton) {

    undoButton.addEventListener(
        "click",
        function () {

            undoLastAction();
        }
    );
}


/* ============================================================
   ANTEPRIMA A GRANDEZZA REALE DI UN FOTOGRAMMA
   ============================================================

   Doppio clic su una miniatura apre il fotogramma completo
   (dimensioni reali della GIF, non della miniatura) in una
   nuova finestra/scheda del browser.
   ============================================================ */

function openFramePreview(frameCanvas, index) {

    const dataUrl =
        frameCanvas.toDataURL("image/png");


    const previewWindow =
        window.open("", "_blank");


    if (!previewWindow) {

        alert(
            "Il browser ha bloccato l'apertura della " +
            "nuova finestra.\n\n" +
            "Consenti i popup per questa pagina e riprova."
        );

        return;
    }


    previewWindow.document.title =
        `Frame #${index + 1} - ${frameCanvas.width}×${frameCanvas.height}`;


    const body =
        previewWindow.document.body;


    body.style.margin = "0";
    body.style.background = "#111827";
    body.style.display = "flex";
    body.style.alignItems = "center";
    body.style.justifyContent = "center";
    body.style.minHeight = "100vh";


    const img =
        previewWindow.document.createElement("img");


    img.src = dataUrl;

    img.width = frameCanvas.width;

    img.height = frameCanvas.height;

    img.style.imageRendering = "pixelated";


    body.appendChild(img);
}


/* ============================================================
   DIMENSIONE MINIATURE (SLIDER)
   ============================================================ */

const thumbSizeSlider = $("thumb-size-slider");
const thumbSizeValueLabel = $("thumb-size-value");

function updateThumbSizeLabel() {

    if (thumbSizeValueLabel && thumbSizeSlider) {

        thumbSizeValueLabel.textContent =
            thumbSizeSlider.value + "px";
    }
}

if (thumbSizeSlider) {

    thumbSizeSlider.addEventListener(
        "input",
        function () {

            document.documentElement.style.setProperty(
                "--thumb-size",
                thumbSizeSlider.value + "px"
            );

            updateThumbSizeLabel();
        }
    );

    updateThumbSizeLabel();
}


/* ============================================================
   CONTROLLO GIFUCT-JS
   ============================================================ */

function getGifuct() {

    /*
       Versione normalmente utilizzata:
       window.gifuct
    */

    if (
        window.gifuct &&
        typeof window.gifuct.parseGIF === "function" &&
        typeof window.gifuct.decompressFrames === "function"
    ) {

        return {
            type: "modern",
            library: window.gifuct
        };
    }


    /*
       Alcune build espongono gifuctjs.
    */

    if (
        window.gifuctjs &&
        typeof window.gifuctjs.parseGIF === "function" &&
        typeof window.gifuctjs.decompressFrames === "function"
    ) {

        return {
            type: "modern",
            library: window.gifuctjs
        };
    }


    /*
       Compatibilità con eventuali build che espongono GIF.
    */

    if (
        typeof window.GIF === "function"
    ) {

        return {
            type: "legacy",
            library: window.GIF
        };
    }


    return null;
}


/* ============================================================
   CONTROLLO GIFSHOT
   ============================================================ */

function getGifshot() {

    if (
        window.gifshot &&
        typeof window.gifshot.createGIF === "function"
    ) {

        return window.gifshot;
    }

    return null;
}


/* ============================================================
   CARICAMENTO FILE GIF
   ============================================================ */

if (fileInput) {

    fileInput.addEventListener(
        "change",
        async function (event) {

            const file =
                event.target.files[0];

            if (!file) {
                return;
            }


            /* Controllo estensione */

            if (
                file.type !== "image/gif" &&
                !file.name
                    .toLowerCase()
                    .endsWith(".gif")
            ) {

                alert(
                    "Il file selezionato non è una GIF."
                );

                fileInput.value = "";

                return;
            }


            /* Stato caricamento */

            if (loading) {
                loading.style.display = "inline";
            }


            if (workspace) {
                workspace.style.display = "none";
            }

            if (cropWorkspace) {
                cropWorkspace.style.display = "none";
            }

            if (exportWorkspace) {
                exportWorkspace.style.display = "none";
            }

            if (importWorkspace) {
                importWorkspace.style.display = "none";
            }


            if (exportPreview) {
                exportPreview.style.display = "none";
            }


            /*
               Nuovo file: azzeriamo selezione, undo,
               velocità, stato di esportazione precedente
               e un eventuale import di una seconda GIF
               rimasto a metà.
            */

            selectedFrames.clear();

            undoStack = [];

            importFrames = [];

            importGifWidth = 0;

            importGifHeight = 0;

            importPreviewOverrideIndex = null;

            importDragState = null;

            speedMultiplier = 1;

            const speedSliderReset =
                $("speed-slider");

            if (speedSliderReset) {

                speedSliderReset.value = "1";
            }

            if (exportStatus) {

                exportStatus.textContent = "";
            }

            if (exportSummary) {

                exportSummary.textContent = "";
            }

            const oldDownloadButton =
                $("download-gif");

            if (oldDownloadButton) {

                oldDownloadButton.remove();
            }


            try {

                console.log(
                    "GIF Frame Master: caricamento:",
                    file.name
                );


                const buffer =
                    await file.arrayBuffer();


                await loadGif(buffer);


                console.log(
                    "GIF caricata correttamente."
                );

            }
            catch (error) {

                console.error(
                    "ERRORE GIF:",
                    error
                );


                alert(
                    "Impossibile leggere la GIF.\n\n" +
                    "Errore: " +
                    error.message
                );
            }
            finally {

                if (loading) {
                    loading.style.display = "none";
                }


                /*
                   Svuota la selezione del file.

                   In questo modo è possibile selezionare
                   nuovamente anche lo stesso identico file
                   per ripartire da zero.
                */

                fileInput.value = "";
            }
        }
    );
}


/* ============================================================
   LETTURA GIF
   ============================================================ */

async function loadGif(buffer) {

    const gifuct =
        getGifuct();


    /*
       Se non troviamo gifuct-js,
       fermiamo l'elaborazione.
    */

    if (!gifuct) {

        throw new Error(
            "gifuct-js non è stato trovato.\n\n" +
            "Controlla che il file gifuct-js.min.js " +
            "sia presente nella cartella dell'estensione."
        );
    }


    console.log(
        "gifuct-js trovato:",
        gifuct.type
    );


    let gif = null;
    let frames = null;


    /* ========================================================
       API MODERNA
       ======================================================== */

    if (
        gifuct.type === "modern"
    ) {

        console.log(
            "Utilizzo API moderna gifuct-js."
        );


        gif =
            gifuct.library.parseGIF(
                buffer
            );


        frames =
            gifuct.library.decompressFrames(
                gif,
                true
            );
    }


    /* ========================================================
       API LEGACY
       ======================================================== */

    else if (
        gifuct.type === "legacy"
    ) {

        console.log(
            "Utilizzo API legacy gifuct-js."
        );


        const decoder =
            new gifuct.library(
                buffer
            );


        frames =
            decoder.decompressFrames(
                true
            );
    }


    /* ========================================================
       CONTROLLO RISULTATO
       ======================================================== */

    if (
        !frames ||
        !Array.isArray(frames) ||
        frames.length === 0
    ) {

        throw new Error(
            "Nessun fotogramma trovato nella GIF."
        );
    }


    console.log(
        "Fotogrammi trovati:",
        frames.length
    );


    /* ========================================================
       DIMENSIONI GIF
       ======================================================== */

    if (
        gif &&
        gif.lsd &&
        gif.lsd.width &&
        gif.lsd.height
    ) {

        gifWidth =
            gif.lsd.width;

        gifHeight =
            gif.lsd.height;
    }

    else if (
        frames[0].dims
    ) {

        /*
           Fallback.
        */

        gifWidth =
            frames[0].dims.width;

        gifHeight =
            frames[0].dims.height;
    }


    if (
        !gifWidth ||
        !gifHeight
    ) {

        throw new Error(
            "Impossibile determinare le dimensioni della GIF."
        );
    }


    /* ========================================================
       SALVATAGGIO FRAME ORIGINALI
       ======================================================== */

    originalFrames =
        frames;


    selectedFrames.clear();


    /* ========================================================
       RICOSTRUZIONE FRAME COMPLETI
       ======================================================== */

    composedFrames =
        composeAllFrames(
            frames,
            gifWidth,
            gifHeight
        );


    if (
        !composedFrames.length
    ) {

        throw new Error(
            "Impossibile ricostruire i fotogrammi."
        );
    }


    /* ========================================================
       AGGIORNAMENTO INTERFACCIA
       ======================================================== */

    if (gifDimensions) {

        gifDimensions.textContent =
            `${gifWidth} × ${gifHeight} px`;
    }


    renderFramesGrid();


    if (workspace) {
        workspace.style.display = "block";
    }

    if (cropWorkspace) {
        cropWorkspace.style.display = "block";
    }

    if (exportWorkspace) {
        exportWorkspace.style.display = "block";
    }


    cropPreviewOverrideIndex = null;

    const cropPreviewFrameReset =
        $("crop-preview-frame");

    if (cropPreviewFrameReset) {

        cropPreviewFrameReset.value = "1";

        cropPreviewFrameReset.max =
            composedFrames.length;
    }

    resetCrop();

    updateCropPreview();

    updateFrameCount();

    updateSpeedPreview();
}


/* ============================================================
   RICOSTRUZIONE COMPLETA DEI FRAME
   ============================================================ */

function composeAllFrames(
    frames,
    width,
    height
) {

    const result = [];


    const canvas =
        document.createElement("canvas");


    canvas.width =
        width;

    canvas.height =
        height;


    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently: true
            }
        );


    /*
       Canvas inizialmente trasparente.
    */

    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    let previousFrame = null;

    let previousCanvasData = null;


    for (
        let i = 0;
        i < frames.length;
        i++
    ) {

        const frame =
            frames[i];


        /* ====================================================
           DISPOSAL FRAME PRECEDENTE
           ==================================================== */

        if (previousFrame) {

            /*
               Disposal 2:
               cancella la zona del frame precedente.
            */

            if (
                previousFrame.disposalType === 2
            ) {

                const d =
                    previousFrame.dims;


                ctx.clearRect(
                    d.left,
                    d.top,
                    d.width,
                    d.height
                );
            }


            /*
               Disposal 3:
               ripristina lo stato precedente.
            */

            else if (
                previousFrame.disposalType === 3 &&
                previousCanvasData
            ) {

                ctx.putImageData(
                    previousCanvasData,
                    0,
                    0
                );
            }
        }


        /* ====================================================
           SALVATAGGIO STATO PRIMA DEL FRAME
           ==================================================== */

        if (
            frame.disposalType === 3
        ) {

            previousCanvasData =
                ctx.getImageData(
                    0,
                    0,
                    width,
                    height
                );
        }

        else {

            previousCanvasData = null;
        }


        /* ====================================================
           DISEGNO PATCH
           ==================================================== */

        if (
            frame.patch &&
            frame.dims
        ) {

            const imageData =
                new ImageData(
                    frame.patch,
                    frame.dims.width,
                    frame.dims.height
                );


            ctx.putImageData(
                imageData,
                frame.dims.left,
                frame.dims.top
            );
        }


        /* ====================================================
           COPIA COMPLETA DEL FRAME
           ==================================================== */

        const frameCanvas =
            document.createElement("canvas");


        frameCanvas.width =
            width;

        frameCanvas.height =
            height;


        const frameCtx =
            frameCanvas.getContext("2d");


        frameCtx.drawImage(
            canvas,
            0,
            0
        );


        result.push({

            canvas: frameCanvas,

            delay:
                normalizeDelay(
                    frame.delay
                ),

            disposalType:
                frame.disposalType || 0
        });


        previousFrame =
            frame;
    }


    return result;
}


/* ============================================================
   NORMALIZZAZIONE DEL DELAY
   ============================================================ */

function normalizeDelay(delay) {

    let value =
        Number(delay);


    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        value = 100;
    }


    return Math.max(
        10,
        Math.round(value)
    );
}


/* ============================================================
   RENDER GRIGLIA
   ============================================================ */

function renderFramesGrid() {

    if (!framesGrid) {
        return;
    }


    framesGrid.innerHTML = "";


    composedFrames.forEach(
        function (frameData, index) {

            const card =
                document.createElement("div");


            card.className =
                "frame-card";


            if (
                selectedFrames.has(index)
            ) {

                card.classList.add(
                    "selected"
                );
            }


            /* ----------------------------------------------
               Badge
               ---------------------------------------------- */

            const badge =
                document.createElement("div");


            badge.className =
                "frame-badge";


            badge.textContent =
                `#${index + 1}`;


            /* ----------------------------------------------
               Canvas
               ---------------------------------------------- */

            const canvas =
                document.createElement("canvas");


            canvas.width =
                gifWidth;

            canvas.height =
                gifHeight;


            const ctx =
                canvas.getContext("2d");


            ctx.drawImage(
                frameData.canvas,
                0,
                0
            );


            /* ----------------------------------------------
               Informazioni delay
               ---------------------------------------------- */

            const info =
                document.createElement("div");


            info.className =
                "frame-info";


            info.textContent =
                `${frameData.delay} ms`;


            card.appendChild(
                badge
            );

            card.appendChild(
                canvas
            );

            card.appendChild(
                info
            );


            /* ----------------------------------------------
               Selezione (singolo clic)
               ---------------------------------------------- */

            card.addEventListener(
                "click",
                function (event) {

                    pushUndoSnapshot();


                    /*
                       SHIFT + clic:
                       seleziona l'intervallo compreso tra
                       l'ultimo frame cliccato e quello attuale.
                    */

                    if (
                        event.shiftKey &&
                        lastSelectedFrameIndex !== null
                    ) {

                        const start =
                            Math.min(
                                lastSelectedFrameIndex,
                                index
                            );


                        const end =
                            Math.max(
                                lastSelectedFrameIndex,
                                index
                            );


                        for (
                            let i = start;
                            i <= end;
                            i++
                        ) {

                            selectedFrames.add(i);
                        }

                    }

                    else {

                        toggleFrameSelection(
                            index
                        );
                    }


                    lastSelectedFrameIndex =
                        index;


                    renderFramesGrid();

                    updateFrameCount();

                    updateCropPreview();

                    updateSpeedPreview();
                }
            );


            /* ----------------------------------------------
               Anteprima a grandezza reale (doppio clic)
               ---------------------------------------------- */

            card.addEventListener(
                "dblclick",
                function (event) {

                    event.stopPropagation();

                    openFramePreview(
                        frameData.canvas,
                        index
                    );
                }
            );


            framesGrid.appendChild(
                card
            );
        }
    );


    updateFrameCount();
}


/* ============================================================
   ULTIMO FRAME CLICCATO
   Utilizzato per la selezione SHIFT.
   ============================================================ */

let lastSelectedFrameIndex = null;


/* ============================================================
   SELEZIONE FRAME
   ============================================================ */

function toggleFrameSelection(index) {

    if (
        selectedFrames.has(index)
    ) {

        selectedFrames.delete(
            index
        );
    }

    else {

        selectedFrames.add(
            index
        );
    }
}


/* ============================================================
   SELEZIONA TUTTI
   ============================================================ */

const selectAllButton =
    $("select-all");


if (selectAllButton) {

    selectAllButton.addEventListener(
        "click",
        function () {

            pushUndoSnapshot();

            selectedFrames.clear();


            for (
                let i = 0;
                i < composedFrames.length;
                i++
            ) {

                selectedFrames.add(i);
            }


            lastSelectedFrameIndex =
                null;


            renderFramesGrid();

            updateCropPreview();

            updateSpeedPreview();
        }
    );
}


/* ============================================================
   DESELEZIONA TUTTI
   ============================================================ */

const deselectAllButton =
    $("deselect-all");


if (deselectAllButton) {

    deselectAllButton.addEventListener(
        "click",
        function () {

            pushUndoSnapshot();

            selectedFrames.clear();

            lastSelectedFrameIndex =
                null;

            renderFramesGrid();

            updateCropPreview();

            updateSpeedPreview();
        }
    );
}


/* ============================================================
   INVERTI SELEZIONE
   ============================================================ */

const invertSelectionButton = $("invert-selection");

if (invertSelectionButton) {

    invertSelectionButton.addEventListener(
        "click",
        function () {

            pushUndoSnapshot();

            const inverted = new Set();

            for (let i = 0; i < composedFrames.length; i++) {

                if (!selectedFrames.has(i)) {
                    inverted.add(i);
                }
            }

            selectedFrames = inverted;

            lastSelectedFrameIndex = null;

            renderFramesGrid();
            updateFrameCount();
            updateCropPreview();
            updateSpeedPreview();
        }
    );
}


/* ============================================================
   DECIMAZIONE: RIMUOVI 1 FRAME OGNI N (tra i restanti)
   ============================================================ */

const decimateButton = $("decimate-frames");
const decimateInput = $("decimate-n");

if (decimateButton) {

    decimateButton.addEventListener(
        "click",
        function () {

            let n = decimateInput
                ? parseInt(decimateInput.value, 10)
                : 2;

            if (!Number.isFinite(n) || n < 2) {
                n = 2;
            }

            pushUndoSnapshot();

            const activeIndices = [];

            for (let i = 0; i < composedFrames.length; i++) {

                if (!selectedFrames.has(i)) {
                    activeIndices.push(i);
                }
            }

            for (let i = 0; i < activeIndices.length; i++) {

                if ((i + 1) % n === 0) {
                    selectedFrames.add(activeIndices[i]);
                }
            }

            lastSelectedFrameIndex = null;

            renderFramesGrid();
            updateFrameCount();
            updateCropPreview();
            updateSpeedPreview();
        }
    );
}


/* ============================================================
   RILEVAMENTO FRAME DUPLICATI / QUASI IDENTICI
   ============================================================

   Confrontiamo ogni fotogramma "attivo" con l'ultimo
   fotogramma tenuto come riferimento, usando una miniatura
   in scala di grigi.

   Se la differenza media è sotto la soglia scelta, il
   fotogramma viene considerato un duplicato e selezionato
   (quindi escluso dall'export / rimovibile dalla vista),
   ma il riferimento NON cambia: questo permette di
   raggruppare intere sequenze quasi identiche, non solo
   coppie consecutive.
   ============================================================ */

const DEDUPE_THUMB_W = 32;
const DEDUPE_THUMB_H = 24;

function getFrameThumbnailGray(frameCanvas) {

    const thumb =
        document.createElement("canvas");

    thumb.width = DEDUPE_THUMB_W;
    thumb.height = DEDUPE_THUMB_H;

    const ctx =
        thumb.getContext(
            "2d",
            { willReadFrequently: true }
        );

    ctx.drawImage(
        frameCanvas,
        0,
        0,
        DEDUPE_THUMB_W,
        DEDUPE_THUMB_H
    );

    const data =
        ctx.getImageData(
            0,
            0,
            DEDUPE_THUMB_W,
            DEDUPE_THUMB_H
        ).data;

    const gray =
        new Uint8ClampedArray(
            DEDUPE_THUMB_W * DEDUPE_THUMB_H
        );

    for (
        let i = 0, p = 0;
        i < data.length;
        i += 4, p++
    ) {

        gray[p] =
            data[i] * 0.299 +
            data[i + 1] * 0.587 +
            data[i + 2] * 0.114;
    }

    return gray;
}

function frameDiffPercentage(grayA, grayB) {

    let sum = 0;

    for (let i = 0; i < grayA.length; i++) {

        sum += Math.abs(grayA[i] - grayB[i]);
    }

    const maxSum = grayA.length * 255;

    return (sum / maxSum) * 100;
}

const detectDuplicatesButton = $("detect-duplicates");
const duplicateThreshold = $("duplicate-threshold");

if (detectDuplicatesButton) {

    detectDuplicatesButton.addEventListener(
        "click",
        function () {

            if (composedFrames.length === 0) {
                return;
            }

            let threshold = duplicateThreshold
                ? parseFloat(duplicateThreshold.value)
                : 3;

            if (!Number.isFinite(threshold) || threshold < 0) {
                threshold = 3;
            }

            pushUndoSnapshot();

            let referenceGray = null;
            let markedCount = 0;

            for (let i = 0; i < composedFrames.length; i++) {

                if (selectedFrames.has(i)) {
                    continue;
                }

                const gray =
                    getFrameThumbnailGray(
                        composedFrames[i].canvas
                    );

                if (referenceGray) {

                    const diff =
                        frameDiffPercentage(
                            referenceGray,
                            gray
                        );

                    if (diff <= threshold) {

                        selectedFrames.add(i);
                        markedCount++;
                        continue;
                    }
                }

                referenceGray = gray;
            }

            lastSelectedFrameIndex = null;

            renderFramesGrid();
            updateFrameCount();
            updateCropPreview();
            updateSpeedPreview();

            alert(
                `Rilevati e selezionati ${markedCount} ` +
                `fotogrammi simili (soglia ${threshold}%).`
            );
        }
    );
}


/* ============================================================
   RIMUOVI SELEZIONATI DALLA VISTA
   ============================================================

   A differenza della semplice selezione (che esclude solo
   dall'export), questo pulsante toglie fisicamente i
   fotogrammi selezionati dall'elenco: utile per alleggerire
   la griglia su GIF con molti fotogrammi.

   L'azione è reversibile con "Annulla".
   ============================================================ */

const removeSelectedButton =
    $("remove-selected");


if (removeSelectedButton) {

    removeSelectedButton.addEventListener(
        "click",
        function () {

            if (selectedFrames.size === 0) {

                alert(
                    "Nessun fotogramma selezionato da rimuovere."
                );

                return;
            }

            pushUndoSnapshot();

            const kept = [];

            for (let i = 0; i < composedFrames.length; i++) {

                if (!selectedFrames.has(i)) {
                    kept.push(composedFrames[i]);
                }
            }

            composedFrames = kept;

            selectedFrames.clear();

            lastSelectedFrameIndex = null;

            renderFramesGrid();
            updateFrameCount();
            updateCropPreview();
            updateSpeedPreview();
        }
    );
}


/* ============================================================
   CONTEGGIO FRAME
   ============================================================ */

function updateFrameCount() {

    if (!frameCount) {
        return;
    }


    const total =
        composedFrames.length;


    const removed =
        selectedFrames.size;


    const active =
        total - removed;


    frameCount.textContent =
        `${active} fotogrammi attivi (${removed} rimossi)`;
}


/* ============================================================
   PRIMO FRAME ATTIVO
   ============================================================ */

function getFirstActiveFrameIndex() {

    for (
        let i = 0;
        i < composedFrames.length;
        i++
    ) {

        if (
            !selectedFrames.has(i)
        ) {

            return i;
        }
    }


    return -1;
}


/* ============================================================
   FOTOGRAMMA SCELTO MANUALMENTE PER L'ANTEPRIMA DI CROP
   ============================================================

   Se l'utente ha inserito un numero di fotogramma valido
   nel pannello di ritaglio, usiamo quello al posto del
   primo fotogramma attivo (indipendentemente dal fatto
   che sia selezionato/escluso dall'export: qui stiamo
   solo scegliendo cosa vedere per impostare il ritaglio).
   ============================================================ */

function getCropPreviewFrameIndex() {

    if (
        cropPreviewOverrideIndex !== null &&
        cropPreviewOverrideIndex >= 0 &&
        cropPreviewOverrideIndex < composedFrames.length
    ) {

        return cropPreviewOverrideIndex;
    }

    return getFirstActiveFrameIndex();
}


/* ============================================================
   ANTEPRIMA CROP
   ============================================================ */

function updateCropPreview() {

    if (!cropCanvas) {
        return;
    }


    const index =
        getCropPreviewFrameIndex();


    if (index === -1) {

        if (cropSelection) {

            cropSelection.style.display =
                "none";
        }

        return;
    }


    const frame =
        composedFrames[index];


    cropCanvas.width =
        gifWidth;

    cropCanvas.height =
        gifHeight;


    const ctx =
        cropCanvas.getContext("2d");


    ctx.clearRect(
        0,
        0,
        gifWidth,
        gifHeight
    );


    ctx.drawImage(
        frame.canvas,
        0,
        0
    );


    resizeCropCanvasDisplay();

    updateCropSelectionDisplay();
}


/* ============================================================
   DIMENSIONI DISPLAY CROP
   ============================================================ */

function resizeCropCanvasDisplay() {

    if (
        !cropCanvas ||
        !gifWidth ||
        !gifHeight
    ) {

        return;
    }


    const maxWidth = 850;
    const maxHeight = 500;


    const scale =
        Math.min(
            1,
            maxWidth / gifWidth,
            maxHeight / gifHeight
        );


    const displayWidth =
        Math.round(
            gifWidth * scale
        );


    const displayHeight =
        Math.round(
            gifHeight * scale
        );


    cropCanvas.style.width =
        `${displayWidth}px`;


    cropCanvas.style.height =
        `${displayHeight}px`;


    if (cropContainer) {

        cropContainer.style.width =
            `${displayWidth}px`;

        cropContainer.style.height =
            `${displayHeight}px`;
    }
}


/* ============================================================
   RESET CROP
   ============================================================ */

function resetCrop() {

    cropRect = {

        x: 0,

        y: 0,

        width: gifWidth,

        height: gifHeight
    };


    updateCropSelectionDisplay();
}


/* ============================================================
   PULSANTE RESET CROP
   ============================================================ */

const resetCropButton =
    $("reset-crop");


if (resetCropButton) {

    resetCropButton.addEventListener(
        "click",
        function () {

            resetCrop();
        }
    );
}


/* ============================================================
   SCELTA MANUALE DEL FOTOGRAMMA DA MOSTRARE NEL CROP
   ============================================================ */

const cropPreviewFrameInput = $("crop-preview-frame");
const cropPreviewRefreshButton = $("crop-preview-refresh");

function applyCropPreviewFrameChoice() {

    if (!cropPreviewFrameInput) {
        return;
    }

    if (composedFrames.length === 0) {
        return;
    }

    let n = parseInt(cropPreviewFrameInput.value, 10);

    if (!Number.isFinite(n) || n < 1) {
        n = 1;
    }

    if (n > composedFrames.length) {
        n = composedFrames.length;
    }

    cropPreviewFrameInput.value = n;

    cropPreviewOverrideIndex = n - 1;

    updateCropPreview();
}

if (cropPreviewRefreshButton) {

    cropPreviewRefreshButton.addEventListener(
        "click",
        function () {

            applyCropPreviewFrameChoice();
        }
    );
}

if (cropPreviewFrameInput) {

    cropPreviewFrameInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                applyCropPreviewFrameChoice();
            }
        }
    );
}


/* ============================================================
   VISUALIZZAZIONE RETTANGOLO CROP
   ============================================================ */

function updateCropSelectionDisplay() {

    if (
        !cropSelection ||
        !cropCanvas ||
        !gifWidth ||
        !gifHeight
    ) {

        return;
    }


    const rect =
        cropCanvas.getBoundingClientRect();


    if (
        rect.width <= 0 ||
        rect.height <= 0
    ) {

        return;
    }


    const scaleX =
        rect.width / gifWidth;


    const scaleY =
        rect.height / gifHeight;


    cropSelection.style.display =
        "block";


    cropSelection.style.left =
        `${cropRect.x * scaleX}px`;


    cropSelection.style.top =
        `${cropRect.y * scaleY}px`;


    cropSelection.style.width =
        `${cropRect.width * scaleX}px`;


    cropSelection.style.height =
        `${cropRect.height * scaleY}px`;


    if (cropX) {

        cropX.textContent =
            Math.round(cropRect.x);
    }


    if (cropY) {

        cropY.textContent =
            Math.round(cropRect.y);
    }


    if (cropWidth) {

        cropWidth.textContent =
            Math.round(cropRect.width);
    }


    if (cropHeight) {

        cropHeight.textContent =
            Math.round(cropRect.height);
    }
}


/* ============================================================
   CROP - POINTER DOWN
   ============================================================ */

if (cropSelection) {

    cropSelection.addEventListener(
        "pointerdown",
        function (event) {

            event.preventDefault();

            event.stopPropagation();


            const handle =
                event.target.dataset.handle;


            cropInteraction = {

                mode:
                    handle || "move",

                startX:
                    event.clientX,

                startY:
                    event.clientY,

                original: {

                    x:
                        cropRect.x,

                    y:
                        cropRect.y,

                    width:
                        cropRect.width,

                    height:
                        cropRect.height
                }
            };


            try {

                cropSelection.setPointerCapture(
                    event.pointerId
                );

            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );


    /* ========================================================
       CROP - POINTER MOVE
       ======================================================== */

    cropSelection.addEventListener(
        "pointermove",
        function (event) {

            if (!cropInteraction) {
                return;
            }


            event.preventDefault();


            const rect =
                cropCanvas.getBoundingClientRect();


            if (
                rect.width <= 0 ||
                rect.height <= 0
            ) {

                return;
            }


            const scaleX =
                gifWidth / rect.width;


            const scaleY =
                gifHeight / rect.height;


            const dx =
                (event.clientX -
                    cropInteraction.startX) *
                scaleX;


            const dy =
                (event.clientY -
                    cropInteraction.startY) *
                scaleY;


            const original =
                cropInteraction.original;


            let x =
                original.x;

            let y =
                original.y;

            let width =
                original.width;

            let height =
                original.height;


            const minSize = 2;


            /* --------------------------------------------
               MOVE
               -------------------------------------------- */

            if (
                cropInteraction.mode === "move"
            ) {

                x =
                    original.x + dx;

                y =
                    original.y + dy;


                x =
                    Math.max(
                        0,
                        Math.min(
                            x,
                            gifWidth -
                            original.width
                        )
                    );


                y =
                    Math.max(
                        0,
                        Math.min(
                            y,
                            gifHeight -
                            original.height
                        )
                    );
            }


            /* --------------------------------------------
               NW
               -------------------------------------------- */

            else if (
                cropInteraction.mode === "nw"
            ) {

                x =
                    original.x + dx;

                y =
                    original.y + dy;

                width =
                    original.width - dx;

                height =
                    original.height - dy;


                if (width < minSize) {

                    width = minSize;

                    x =
                        original.x +
                        original.width -
                        minSize;
                }


                if (height < minSize) {

                    height = minSize;

                    y =
                        original.y +
                        original.height -
                        minSize;
                }


                x =
                    Math.max(
                        0,
                        x
                    );

                y =
                    Math.max(
                        0,
                        y
                    );
            }


            /* --------------------------------------------
               NE
               -------------------------------------------- */

            else if (
                cropInteraction.mode === "ne"
            ) {

                y =
                    original.y + dy;

                width =
                    original.width + dx;

                height =
                    original.height - dy;


                if (width < minSize) {

                    width =
                        minSize;
                }


                if (height < minSize) {

                    height =
                        minSize;

                    y =
                        original.y +
                        original.height -
                        minSize;
                }


                width =
                    Math.min(
                        width,
                        gifWidth -
                        original.x
                    );


                y =
                    Math.max(
                        0,
                        y
                    );
            }


            /* --------------------------------------------
               SW
               -------------------------------------------- */

            else if (
                cropInteraction.mode === "sw"
            ) {

                x =
                    original.x + dx;

                width =
                    original.width - dx;

                height =
                    original.height + dy;


                if (width < minSize) {

                    width =
                        minSize;

                    x =
                        original.x +
                        original.width -
                        minSize;
                }


                if (height < minSize) {

                    height =
                        minSize;
                }


                x =
                    Math.max(
                        0,
                        x
                    );


                height =
                    Math.min(
                        height,
                        gifHeight -
                        original.y
                    );
            }


            /* --------------------------------------------
               SE
               -------------------------------------------- */

            else if (
                cropInteraction.mode === "se"
            ) {

                width =
                    original.width + dx;

                height =
                    original.height + dy;


                width =
                    Math.max(
                        minSize,
                        width
                    );


                height =
                    Math.max(
                        minSize,
                        height
                    );


                width =
                    Math.min(
                        width,
                        gifWidth -
                        original.x
                    );


                height =
                    Math.min(
                        height,
                        gifHeight -
                        original.y
                    );
            }


            cropRect = {

                x:
                    Math.round(x),

                y:
                    Math.round(y),

                width:
                    Math.round(width),

                height:
                    Math.round(height)
            };


            updateCropSelectionDisplay();
        }
    );


    /* ========================================================
       POINTER UP
       ======================================================== */

    cropSelection.addEventListener(
        "pointerup",
        function (event) {

            cropInteraction = null;


            try {

                cropSelection.releasePointerCapture(
                    event.pointerId
                );

            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );


    cropSelection.addEventListener(
        "pointercancel",
        function () {

            cropInteraction = null;
        }
    );
}


/* ============================================================
   RIDIMENSIONAMENTO FINESTRA
   ============================================================ */

window.addEventListener(
    "resize",
    function () {

        resizeCropCanvasDisplay();

        updateCropSelectionDisplay();

        resizeImportWindowDisplay();

        updateImportTransformDisplay();
    }
);


/* ============================================================
   AGGIUNTA DI UNA SECONDA GIF IN CODA
   ============================================================

   Il pulsante "+" nella toolbar dei fotogrammi apre un
   pannello dedicato dove l'utente può caricare una seconda
   GIF, posizionarla (trascinamento + zoom) dentro una
   finestra fissa che rappresenta le dimensioni della GIF
   principale (esattamente come il ritaglio circolare di un
   avatar), scegliere un colore di sfondo per le zone
   scoperte e infine accodare i fotogrammi risultanti in
   fondo a "composedFrames".

   Vengono mantenuti solo i fotogrammi (immagine + delay
   originale) della seconda GIF: velocità, ping-pong e
   crop restano proprietà globali dell'esportazione e si
   applicano automaticamente anche ai fotogrammi importati.
   ============================================================ */

let importFrames = [];

let importGifWidth = 0;
let importGifHeight = 0;

let importScale = 1;
let importPanX = 0;
let importPanY = 0;

let importBackgroundColor = "#ffffff";

let importPreviewOverrideIndex = null;

let importDragState = null;

const importWorkspace = $("import-workspace");
const importWindow = $("import-window");
const importDragCanvas = $("import-drag-canvas");

const addGifQueueButton = $("add-gif-queue");
const importGifFileInput = $("import-gif-file");

const importPreviewFrameInput = $("import-preview-frame");
const importPreviewRefreshButton = $("import-preview-refresh");

const importZoomSlider = $("import-zoom");
const importBgColorInput = $("import-bgcolor");

const importPresetCoverButton = $("import-preset-cover");
const importPresetContainButton = $("import-preset-contain");

const importConfirmButton = $("import-confirm");
const importCancelButton = $("import-cancel");

const importTargetDimsLabel = $("import-target-dims");


/* ----------------------------------------------------------
   APERTURA PANNELLO (pulsante "+")
   ---------------------------------------------------------- */

if (addGifQueueButton) {

    addGifQueueButton.addEventListener(
        "click",
        function () {

            if (composedFrames.length === 0) {

                alert(
                    "Carica prima una GIF principale."
                );

                return;
            }

            if (importGifFileInput) {

                importGifFileInput.click();
            }
        }
    );
}


/* ----------------------------------------------------------
   CARICAMENTO DELLA SECONDA GIF
   ---------------------------------------------------------- */

if (importGifFileInput) {

    importGifFileInput.addEventListener(
        "change",
        async function (event) {

            const file =
                event.target.files[0];

            if (!file) {
                return;
            }


            if (
                file.type !== "image/gif" &&
                !file.name
                    .toLowerCase()
                    .endsWith(".gif")
            ) {

                alert(
                    "Il file selezionato non è una GIF."
                );

                importGifFileInput.value = "";

                return;
            }


            try {

                const buffer =
                    await file.arrayBuffer();


                await loadImportGif(
                    buffer
                );
            }
            catch (error) {

                console.error(
                    "ERRORE IMPORT GIF:",
                    error
                );


                alert(
                    "Impossibile leggere la GIF da " +
                    "accodare.\n\nErrore: " +
                    error.message
                );
            }
            finally {

                importGifFileInput.value = "";
            }
        }
    );
}

async function loadImportGif(buffer) {

    const gifuct =
        getGifuct();


    if (!gifuct) {

        throw new Error(
            "gifuct-js non è stato trovato."
        );
    }


    let gif = null;
    let frames = null;


    if (gifuct.type === "modern") {

        gif =
            gifuct.library.parseGIF(
                buffer
            );


        frames =
            gifuct.library.decompressFrames(
                gif,
                true
            );
    }

    else if (gifuct.type === "legacy") {

        const decoder =
            new gifuct.library(
                buffer
            );


        frames =
            decoder.decompressFrames(
                true
            );
    }


    if (
        !frames ||
        !Array.isArray(frames) ||
        frames.length === 0
    ) {

        throw new Error(
            "Nessun fotogramma trovato nella GIF " +
            "da accodare."
        );
    }


    let w = 0;
    let h = 0;


    if (
        gif &&
        gif.lsd &&
        gif.lsd.width &&
        gif.lsd.height
    ) {

        w = gif.lsd.width;
        h = gif.lsd.height;
    }

    else if (frames[0].dims) {

        w = frames[0].dims.width;
        h = frames[0].dims.height;
    }


    if (!w || !h) {

        throw new Error(
            "Impossibile determinare le dimensioni " +
            "della GIF da accodare."
        );
    }


    importFrames =
        composeAllFrames(
            frames,
            w,
            h
        );

    importGifWidth = w;
    importGifHeight = h;


    if (!importFrames.length) {

        throw new Error(
            "Impossibile ricostruire i fotogrammi " +
            "della GIF da accodare."
        );
    }


    importPreviewOverrideIndex = null;


    if (importPreviewFrameInput) {

        importPreviewFrameInput.value = "1";

        importPreviewFrameInput.max =
            importFrames.length;
    }


    if (importTargetDimsLabel) {

        importTargetDimsLabel.textContent =
            `${gifWidth} × ${gifHeight} px`;
    }


    if (importBgColorInput) {

        importBackgroundColor =
            importBgColorInput.value || "#ffffff";
    }


    applyImportPreset("cover");


    if (importWorkspace) {

        importWorkspace.style.display = "block";

        importWorkspace.scrollIntoView(
            {
                behavior: "smooth",
                block: "start"
            }
        );
    }


    renderImportPreviewFrame();
}


/* ----------------------------------------------------------
   SCELTA DEL FOTOGRAMMA DI ANTEPRIMA (GIF DA ACCODARE)
   ---------------------------------------------------------- */

function getImportPreviewFrameIndex() {

    if (
        importPreviewOverrideIndex !== null &&
        importPreviewOverrideIndex >= 0 &&
        importPreviewOverrideIndex < importFrames.length
    ) {

        return importPreviewOverrideIndex;
    }

    return 0;
}

function renderImportPreviewFrame() {

    if (
        !importDragCanvas ||
        importFrames.length === 0
    ) {

        return;
    }


    const index =
        getImportPreviewFrameIndex();


    const frame =
        importFrames[index];


    importDragCanvas.width =
        importGifWidth;

    importDragCanvas.height =
        importGifHeight;


    const ctx =
        importDragCanvas.getContext("2d");


    ctx.clearRect(
        0,
        0,
        importGifWidth,
        importGifHeight
    );


    ctx.drawImage(
        frame.canvas,
        0,
        0
    );


    resizeImportWindowDisplay();

    updateImportTransformDisplay();
}

if (importPreviewRefreshButton) {

    importPreviewRefreshButton.addEventListener(
        "click",
        function () {

            applyImportPreviewFrameChoice();
        }
    );
}

if (importPreviewFrameInput) {

    importPreviewFrameInput.addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                event.preventDefault();

                applyImportPreviewFrameChoice();
            }
        }
    );
}

function applyImportPreviewFrameChoice() {

    if (
        !importPreviewFrameInput ||
        importFrames.length === 0
    ) {

        return;
    }


    let n =
        parseInt(
            importPreviewFrameInput.value,
            10
        );


    if (!Number.isFinite(n) || n < 1) {

        n = 1;
    }


    if (n > importFrames.length) {

        n = importFrames.length;
    }


    importPreviewFrameInput.value = n;

    importPreviewOverrideIndex = n - 1;


    renderImportPreviewFrame();
}


/* ----------------------------------------------------------
   DIMENSIONI DISPLAY DELLA FINESTRA DI IMPORT
   (rappresenta le dimensioni fisse della GIF principale)
   ---------------------------------------------------------- */

function resizeImportWindowDisplay() {

    if (
        !importWindow ||
        !gifWidth ||
        !gifHeight
    ) {

        return;
    }


    const maxWidth = 850;
    const maxHeight = 500;


    const scale =
        Math.min(
            1,
            maxWidth / gifWidth,
            maxHeight / gifHeight
        );


    const displayWidth =
        Math.round(
            gifWidth * scale
        );


    const displayHeight =
        Math.round(
            gifHeight * scale
        );


    importWindow.style.width =
        `${displayWidth}px`;

    importWindow.style.height =
        `${displayHeight}px`;
}


/* ----------------------------------------------------------
   AGGIORNAMENTO POSIZIONE/ZOOM DEL FOTOGRAMMA DA ACCODARE
   ---------------------------------------------------------- */

function updateImportTransformDisplay() {

    if (
        !importDragCanvas ||
        !importWindow ||
        !gifWidth ||
        !gifHeight
    ) {

        return;
    }


    importWindow.style.background =
        importBackgroundColor;


    const rect =
        importWindow.getBoundingClientRect();


    if (rect.width <= 0) {

        return;
    }


    const displayScale =
        rect.width / gifWidth;


    const drawWidth =
        importGifWidth *
        importScale *
        displayScale;


    const drawHeight =
        importGifHeight *
        importScale *
        displayScale;


    importDragCanvas.style.width =
        `${drawWidth}px`;

    importDragCanvas.style.height =
        `${drawHeight}px`;

    importDragCanvas.style.left =
        `${importPanX * displayScale}px`;

    importDragCanvas.style.top =
        `${importPanY * displayScale}px`;
}


/* ----------------------------------------------------------
   PRESET: ADATTA RIEMPIENDO (cover) / ADATTA CON MARGINI (contain)
   ---------------------------------------------------------- */

function applyImportPreset(kind) {

    if (
        !importGifWidth ||
        !importGifHeight ||
        !gifWidth ||
        !gifHeight
    ) {

        return;
    }


    let scale;


    if (kind === "contain") {

        scale =
            Math.min(
                gifWidth / importGifWidth,
                gifHeight / importGifHeight
            );
    }

    else {

        scale =
            Math.max(
                gifWidth / importGifWidth,
                gifHeight / importGifHeight
            );
    }


    importScale = scale;


    importPanX =
        (gifWidth - importGifWidth * scale) / 2;

    importPanY =
        (gifHeight - importGifHeight * scale) / 2;


    if (importZoomSlider) {

        const minZoom =
            parseFloat(importZoomSlider.min) || 0.05;

        const maxZoom =
            parseFloat(importZoomSlider.max) || 5;

        const clamped =
            Math.max(
                minZoom,
                Math.min(
                    maxZoom,
                    scale
                )
            );

        importZoomSlider.value =
            clamped.toFixed(2);
    }


    updateImportTransformDisplay();
}

if (importPresetCoverButton) {

    importPresetCoverButton.addEventListener(
        "click",
        function () {

            applyImportPreset("cover");
        }
    );
}

if (importPresetContainButton) {

    importPresetContainButton.addEventListener(
        "click",
        function () {

            applyImportPreset("contain");
        }
    );
}


/* ----------------------------------------------------------
   ZOOM MANUALE
   ---------------------------------------------------------- */

if (importZoomSlider) {

    importZoomSlider.addEventListener(
        "input",
        function () {

            const newScale =
                parseFloat(importZoomSlider.value) || 1;


            /*
               Manteniamo fisso il centro attuale
               dell'immagine mentre cambia lo zoom,
               così l'utente non perde il riferimento.
            */

            const centerX =
                importPanX +
                (importGifWidth * importScale) / 2;

            const centerY =
                importPanY +
                (importGifHeight * importScale) / 2;


            importScale = newScale;


            importPanX =
                centerX -
                (importGifWidth * importScale) / 2;

            importPanY =
                centerY -
                (importGifHeight * importScale) / 2;


            updateImportTransformDisplay();
        }
    );
}


/* ----------------------------------------------------------
   COLORE DI SFONDO
   ---------------------------------------------------------- */

if (importBgColorInput) {

    importBgColorInput.addEventListener(
        "input",
        function () {

            importBackgroundColor =
                importBgColorInput.value || "#ffffff";

            if (importWindow) {

                importWindow.style.background =
                    importBackgroundColor;
            }
        }
    );
}


/* ----------------------------------------------------------
   TRASCINAMENTO (PAN) DEL FOTOGRAMMA DA POSIZIONARE
   ---------------------------------------------------------- */

if (importDragCanvas) {

    importDragCanvas.addEventListener(
        "pointerdown",
        function (event) {

            event.preventDefault();


            importDragState = {

                startX:
                    event.clientX,

                startY:
                    event.clientY,

                originalPanX:
                    importPanX,

                originalPanY:
                    importPanY
            };


            try {

                importDragCanvas.setPointerCapture(
                    event.pointerId
                );
            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );

    importDragCanvas.addEventListener(
        "pointermove",
        function (event) {

            if (!importDragState) {
                return;
            }


            event.preventDefault();


            const rect =
                importWindow.getBoundingClientRect();


            if (rect.width <= 0) {
                return;
            }


            const displayScale =
                rect.width / gifWidth;


            const dx =
                (event.clientX -
                    importDragState.startX) /
                displayScale;


            const dy =
                (event.clientY -
                    importDragState.startY) /
                displayScale;


            importPanX =
                importDragState.originalPanX + dx;

            importPanY =
                importDragState.originalPanY + dy;


            updateImportTransformDisplay();
        }
    );

    importDragCanvas.addEventListener(
        "pointerup",
        function (event) {

            importDragState = null;


            try {

                importDragCanvas.releasePointerCapture(
                    event.pointerId
                );
            }
            catch (error) {
                /* ignoriamo */
            }
        }
    );

    importDragCanvas.addEventListener(
        "pointercancel",
        function () {

            importDragState = null;
        }
    );
}


/* ----------------------------------------------------------
   ANNULLA IMPORT
   ---------------------------------------------------------- */

function closeImportWorkspace() {

    importFrames = [];

    importGifWidth = 0;
    importGifHeight = 0;

    importPreviewOverrideIndex = null;

    importDragState = null;


    if (importWorkspace) {

        importWorkspace.style.display = "none";
    }
}

if (importCancelButton) {

    importCancelButton.addEventListener(
        "click",
        function () {

            closeImportWorkspace();
        }
    );
}


/* ----------------------------------------------------------
   CONFERMA: ACCODA I FOTOGRAMMI TRASFORMATI
   ---------------------------------------------------------- */

if (importConfirmButton) {

    importConfirmButton.addEventListener(
        "click",
        function () {

            confirmImportAppend();
        }
    );
}

function confirmImportAppend() {

    if (importFrames.length === 0) {

        alert(
            "Nessuna GIF da accodare."
        );

        return;
    }


    pushUndoSnapshot();


    const drawWidth =
        importGifWidth * importScale;

    const drawHeight =
        importGifHeight * importScale;


    for (
        let i = 0;
        i < importFrames.length;
        i++
    ) {

        const sourceFrame =
            importFrames[i];


        const outCanvas =
            document.createElement("canvas");


        outCanvas.width =
            gifWidth;

        outCanvas.height =
            gifHeight;


        const ctx =
            outCanvas.getContext("2d");


        /*
           Riempimento di sfondo: copre le zone
           scoperte quando il fotogramma importato
           è più piccolo della finestra di GIF1.
        */

        ctx.fillStyle =
            importBackgroundColor || "#ffffff";

        ctx.fillRect(
            0,
            0,
            gifWidth,
            gifHeight
        );


        /*
           Disegno del fotogramma di GIF2 con la
           stessa posizione/zoom scelti dall'utente.

           Se il fotogramma è più grande della
           finestra, la parte eccedente viene
           semplicemente tagliata (il canvas di
           destinazione ha dimensioni fisse).
        */

        ctx.drawImage(
            sourceFrame.canvas,
            0,
            0,
            importGifWidth,
            importGifHeight,
            importPanX,
            importPanY,
            drawWidth,
            drawHeight
        );


        composedFrames.push(
            {

                canvas: outCanvas,

                delay:
                    normalizeDelay(
                        sourceFrame.delay
                    ),

                disposalType: 0
            }
        );
    }


    closeImportWorkspace();


    renderFramesGrid();

    updateFrameCount();

    updateCropPreview();

    updateSpeedPreview();
}


/* ============================================================
   CREA CANVAS CROPPATO
   ============================================================ */

function createCroppedCanvas(
    sourceCanvas
) {

    const output =
        document.createElement("canvas");


    output.width =
        Math.max(
            1,
            Math.round(
                cropRect.width
            )
        );


    output.height =
        Math.max(
            1,
            Math.round(
                cropRect.height
            )
        );


    const ctx =
        output.getContext("2d");


    ctx.clearRect(
        0,
        0,
        output.width,
        output.height
    );


    ctx.drawImage(

        sourceCanvas,

        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height,

        0,
        0,
        output.width,
        output.height
    );


    return output;
}


/* ============================================================
   MASSIMO COMUN DIVISORE
   ============================================================ */

function gcd(a, b) {

    a =
        Math.abs(
            Math.round(a)
        );


    b =
        Math.abs(
            Math.round(b)
        );


    while (b !== 0) {

        const temp =
            a % b;

        a = b;

        b = temp;
    }


    return a || 1;
}


/* ============================================================
   DELAY BASE
   ============================================================ */

function calculateBaseDelay(
    frames
) {

    if (
        !frames.length
    ) {

        return 100;
    }


    let result =
        normalizeDelay(
            frames[0].delay
        );


    for (
        let i = 1;
        i < frames.length;
        i++
    ) {

        result =
            gcd(
                result,
                normalizeDelay(
                    frames[i].delay
                )
            );
    }


    return Math.max(
        10,
        result
    );
}


/* ============================================================
   VELOCITÀ DI RIPRODUZIONE
   ============================================================ */

function getActiveFrameDataForSpeed() {

    const list = [];

    for (let i = 0; i < composedFrames.length; i++) {

        if (!selectedFrames.has(i)) {
            list.push(composedFrames[i]);
        }
    }

    return list;
}

function updateSpeedPreview() {

    const speedValueLabel = $("speed-value");
    const speedDelayPreview = $("speed-delay-preview");

    if (speedValueLabel) {

        speedValueLabel.textContent =
            speedMultiplier.toFixed(1) + "x";
    }

    if (speedDelayPreview) {

        const activeData = getActiveFrameDataForSpeed();

        if (activeData.length === 0) {

            speedDelayPreview.textContent = "";
            return;
        }

        const base = calculateBaseDelay(activeData);

        const effective = Math.max(
            10,
            Math.round(base / speedMultiplier)
        );

        speedDelayPreview.textContent =
            `(${effective} ms/frame)`;
    }
}

const speedSlider = $("speed-slider");

if (speedSlider) {

    speedSlider.addEventListener(
        "input",
        function () {

            speedMultiplier =
                parseFloat(speedSlider.value) || 1;

            updateSpeedPreview();
        }
    );
}


/* ============================================================
   SLIDER QUALITÀ EXPORT (etichetta dinamica)
   ============================================================ */

const exportQualityInput = $("export-quality");
const exportQualityLabel = $("export-quality-value");

function updateExportQualityLabel() {

    if (!exportQualityInput || !exportQualityLabel) {
        return;
    }

    exportQualityLabel.textContent =
        exportQualityInput.value;
}

if (exportQualityInput) {

    exportQualityInput.addEventListener(
        "input",
        updateExportQualityLabel
    );

    updateExportQualityLabel();
}


/* ============================================================
   DIMENSIONE DI UNA DATA URL IN BYTE
   ============================================================

   Calcola la dimensione reale (in byte) dei dati binari
   codificati in una data URL base64, tenendo conto del
   padding finale ("=" oppure "==").
   ============================================================ */

function getDataUrlSizeBytes(dataUrl) {

    const commaIndex =
        dataUrl.indexOf(",");

    if (commaIndex === -1) {
        return 0;
    }

    const base64 =
        dataUrl.slice(commaIndex + 1);

    let padding = 0;

    if (base64.endsWith("==")) {
        padding = 2;
    }
    else if (base64.endsWith("=")) {
        padding = 1;
    }

    return Math.floor(
        (base64.length * 3) / 4
    ) - padding;
}


/* ============================================================
   PREPARAZIONE FRAME PER ESPORTAZIONE
   ============================================================ */

async function prepareExportImages(
    activeIndices
) {

    const images = [];

    const activeFrameData = [];


    for (
        const index of activeIndices
    ) {

        const frame =
            composedFrames[index];


        const cropped =
            createCroppedCanvas(
                frame.canvas
            );


        const dataUrl =
            cropped.toDataURL(
                "image/png"
            );


        images.push(
            dataUrl
        );


        activeFrameData.push(
            frame
        );
    }


    return {
        images,
        activeFrameData
    };
}


/* ============================================================
   PULSANTE ESPORTAZIONE
   ============================================================ */

const exportButton =
    $("export-gif");


if (exportButton) {

    exportButton.addEventListener(
        "click",
        async function () {

            await exportGif();
        }
    );
}


/* ============================================================
   ESPORTAZIONE GIF
   ============================================================ */

async function exportGif() {

    const gifshot =
        getGifshot();


    if (!gifshot) {

        alert(
            "gifshot non è stato caricato.\n\n" +
            "Controlla che gifshot.min.js sia presente " +
            "nella cartella dell'estensione."
        );

        return;
    }


    /* ========================================================
       FRAME ATTIVI
       ======================================================== */

    const activeIndices = [];


    for (
        let i = 0;
        i < composedFrames.length;
        i++
    ) {

        if (
            !selectedFrames.has(i)
        ) {

            activeIndices.push(i);
        }
    }


    if (
        activeIndices.length === 0
    ) {

        alert(
            "Non ci sono fotogrammi attivi da esportare."
        );

        return;
    }


    if (
        !cropRect.width ||
        !cropRect.height
    ) {

        alert(
            "Il riquadro di crop non è valido."
        );

        return;
    }


    /* ========================================================
       EFFETTO PING-PONG (opzionale)
       ========================================================

       Se attivo, dopo la sequenza normale ripetiamo i
       fotogrammi al contrario, escludendo il primo e
       l'ultimo per evitare una "pausa" visibile nel
       punto di inversione.
       ======================================================== */

    const pingPongToggle =
        $("pingpong-toggle");

    const usePingPong =
        pingPongToggle
            ? pingPongToggle.checked
            : false;

    let exportIndices =
        activeIndices;

    if (
        usePingPong &&
        activeIndices.length > 2
    ) {

        const reversedMiddle =
            activeIndices
                .slice(1, -1)
                .reverse();

        exportIndices =
            activeIndices.concat(
                reversedMiddle
            );
    }


    /* ========================================================
       STATO UI
       ======================================================== */

    if (exportButton) {

        exportButton.disabled =
            true;

        exportButton.textContent =
            "Creazione GIF...";
    }


    if (exportStatus) {

        exportStatus.textContent =
            "Preparazione dei fotogrammi...";
    }


    if (exportSummary) {

        exportSummary.textContent = "";
    }


    if (exportPreview) {

        exportPreview.style.display =
            "none";
    }


    try {

        /* ----------------------------------------------------
           PREPARAZIONE
           ---------------------------------------------------- */

        const prepared =
            await prepareExportImages(
                exportIndices
            );


        let images =
            prepared.images;


        const activeFrameData =
            prepared.activeFrameData;


        /* ----------------------------------------------------
           DIMENSIONI
           ---------------------------------------------------- */

        const outputWidth =
            Math.max(
                1,
                Math.round(
                    cropRect.width
                )
            );


        const outputHeight =
            Math.max(
                1,
                Math.round(
                    cropRect.height
                )
            );


        /* ----------------------------------------------------
           DELAY BASE + VELOCITÀ
           ---------------------------------------------------- */

        const baseDelay =
            calculateBaseDelay(
                activeFrameData
            );


        const effectiveDelay =
            Math.max(
                10,
                Math.round(
                    baseDelay / speedMultiplier
                )
            );


        /* ----------------------------------------------------
           QUALITÀ / PESO
           ---------------------------------------------------- */

        let sampleInterval =
            exportQualityInput
                ? parseInt(exportQualityInput.value, 10)
                : 10;

        if (
            !Number.isFinite(sampleInterval) ||
            sampleInterval < 1
        ) {

            sampleInterval = 10;
        }


        /* ----------------------------------------------------
           MANTENIMENTO DEL NUMERO ORIGINALE DI FRAME
           ----------------------------------------------------

           NON duplichiamo fisicamente i frame in base
           al loro delay.

           images rimane un elemento per ogni frame incluso
           nella sequenza di export (ping-pong compreso).
           ---------------------------------------------------- */


        /* ----------------------------------------------------
           STATO
           ---------------------------------------------------- */

        if (exportStatus) {

            exportStatus.textContent =
                `Codifica di ${images.length} immagini...`;
        }


        /* ====================================================
           GIFSHOT
           ==================================================== */

        const options = {

            images: images,

            gifWidth:
                outputWidth,

            gifHeight:
                outputHeight,

            interval:
                effectiveDelay / 1000,

            numFrames:
                images.length,

            sampleInterval:
                sampleInterval,

            numWorkers:
                2,

            progressCallback:
                function (progress) {

                    const percentage =
                        Math.round(
                            progress * 100
                        );


                    if (exportStatus) {

                        exportStatus.textContent =
                            `Codifica GIF: ${percentage}%`;
                    }
                }
        };


        await new Promise(
            function (resolve, reject) {

                gifshot.createGIF(
                    options,
                    function (result) {

                        if (
                            result.error
                        ) {

                            reject(
                                new Error(
                                    result.errorMsg ||
                                    "Errore restituito da gifshot."
                                )
                            );

                            return;
                        }


                        if (
                            !result.image
                        ) {

                            reject(
                                new Error(
                                    "gifshot non ha prodotto la GIF."
                                )
                            );

                            return;
                        }


                        currentExportData =
                            result.image;


                        /* ------------------------------------
                           Preview
                           ------------------------------------ */

                        if (exportPreview) {

                            exportPreview.src =
                                result.image;

                            exportPreview.style.display =
                                "block";
                        }


                        if (exportStatus) {

                            exportStatus.textContent =
                                "GIF creata correttamente.";
                        }


                        /* ------------------------------------
                           Riepilogo: n. fotogrammi + peso
                           ------------------------------------ */

                        if (exportSummary) {

                            const sizeBytes =
                                getDataUrlSizeBytes(
                                    result.image
                                );

                            const sizeMB =
                                (sizeBytes / (1024 * 1024))
                                    .toFixed(2);

                            exportSummary.textContent =
                                `${images.length} fotogrammi esportati` +
                                (usePingPong
                                    ? ` (ping-pong incluso)`
                                    : ``) +
                                ` · ${sizeMB} MB`;
                        }


                        createDownloadButton(
                            result.image
                        );


                        resolve();
                    }
                );
            }
        );
    }


    catch (error) {

        console.error(
            "Errore esportazione GIF:",
            error
        );


        if (exportStatus) {

            exportStatus.textContent =
                "Errore durante la creazione della GIF.";
        }


        alert(
            "Errore durante la creazione della GIF.\n\n" +
            error.message
        );
    }


    finally {

        if (exportButton) {

            exportButton.disabled =
                false;

            exportButton.textContent =
                "Crea nuova GIF";
        }
    }
}


/* ============================================================
   PULSANTE DOWNLOAD
   ============================================================ */

function createDownloadButton(
    dataUrl
) {

    const exportArea =
        document.querySelector(
            ".export-area"
        );


    if (!exportArea) {

        console.warn(
            "Elemento .export-area non trovato."
        );

        return;
    }


    /* Rimuove eventuale vecchio pulsante */

    const oldButton =
        $("download-gif");


    if (oldButton) {

        oldButton.remove();
    }


    const button =
        document.createElement(
            "button"
        );


    button.id =
        "download-gif";


    button.className =
        "primary";


    button.type =
        "button";


    button.textContent =
        "⬇ Scarica GIF";


    button.addEventListener(
        "click",
        function () {

            downloadDataUrl(
                dataUrl,
                "GIF_Frame_Master.gif"
            );
        }
    );


    exportArea.appendChild(
        button
    );
}


/* ============================================================
   DOWNLOAD
   ============================================================ */

function downloadDataUrl(
    dataUrl,
    filename
) {

    const link =
        document.createElement(
            "a"
        );


    link.href =
        dataUrl;


    link.download =
        filename;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();
}


/* ============================================================
   INFORMAZIONI DI DEBUG
   ============================================================ */

console.log(
    "========================================"
);


console.log(
    "GIF Frame Master"
);


console.log(
    "app.js caricato correttamente"
);


console.log(
    "gifuct-js:",
    getGifuct()
        ? "OK"
        : "NON TROVATO"
);


console.log(
    "gifshot:",
    getGifshot()
        ? "OK"
        : "NON TROVATO"
);


console.log(
    "========================================"
);
