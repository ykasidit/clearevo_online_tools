// ClearEvo.com DICOM Viewer - language tables (EN + natural Thai; Thai PACS keeps W/L, Zoom, Tags in English)
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools
//
// Pure data: no DOM. test/dicom_i18n.test.js (the shared language-parity test) fails when a key, type or function arity
// differs between the two tables. Thai is composed, not translated.

export const I18N = {
  en: {
    shareManual: 'Copy this link:', pngSave: 'Save', pngCancel: 'Cancel',
    tsUnsupported: (ts) => `transfer syntax ${ts} is not supported yet - please open an issue at github.com/ykasidit/clearevo_online_tools`,
    archiveRefused: {
      gz: 'This looks like a .gz / .tar.gz. gzip has no random access, so a gigabyte CD would have to be fully downloaded and decompressed. Please unzip it to a plain .tar or a folder first, then open that.',
      '7z': '.7z is not supported: its solid compression blocks prevent reading one slice at a time. Please use a .zip, a plain .tar, or the unzipped CD folder.',
      rar: '.rar is not supported (proprietary format, no license-compatible decoder). Please use a .zip, a plain .tar, or the unzipped CD folder.',
      unknown: 'Unrecognized archive. Please use a .zip, a plain .tar, or the unzipped CD folder / .dcm files.',
    },
    noDicom: 'no DICOM images found - is this a DICOM CD zip/folder?', scanning: (done, total) => `scanning ${done}/${total}...`,
    seriesFound: (s, n) => `${s} series, ${n} images`, seriesIndexed: (s, n) => `${s} series, ${n} images (from index)`,
    seriesStreaming: (s, n) => `${s} series, ${n} images (streaming). For fastest scrolling, download the whole CD and open it locally.`,
    dicomdirUnreadable: (m) => `DICOMDIR unreadable (${m}), scanning files...`, cannotDisplay: (m) => `cannot display: ${m}`,
    imgCount: (n) => `${n} img`, framesCount: (n) => `${n} frames`, open: 'Open file', folder: 'Open folder', cine: 'Cine', pause: 'Pause', capture: 'Save PNG', captureAs: 'PNG as…',
    pngPrompt: 'File name for the PNG:', pngSaved: 'saved - check your Downloads folder', pngFail: 'could not save: ',
    demoDl: 'Demo download started (check your Downloads). When it finishes, press the blinking "Open file" and pick the zip.',
    loadingPreviews: 'Loading series previews…', ready: 'Ready', startReached: 'Start of series', endReached: 'End of series', frame: 'frame', frames: 'frames',
    demoSmall: '▶ Try a demo scan (150 MB) - a real SCDS ear CT', demoCT: '⬇ Full CT demo CD (1.2 GB)', demoMRI: '⬇ Full MRI demo CD (870 MB)',
    share: '📤 Share this tool', shareCopied: 'Link copied - paste it anywhere',
    browse: 'Browse', wl: 'W/L', pan: 'Pan', zoom: 'Zoom', measure: 'Measure', undoPt: 'Undo pt', reset: 'Reset', invert: 'Invert', tags: 'Tags',
    wlSimple: 'Brightness', playSimple: 'Play', captureSimple: 'Save image',
    modeSimple: 'Simple', modeAdvanced: 'Advanced',
    gWLSimple: 'Drag left-right = contrast, up-down = brightness',
    angle: 'Angle', rotate: 'Rotate', flip: 'Flip',
    gAngle: 'Tap three points - the angle is measured at the middle point',
    gBrowse: 'Swipe / drag up-down to scroll slices (wheel and ◀ ▶ too)',
    gWL: 'Drag left-right = window width, up-down = level',
    gPan: 'Drag to move the image',
    gZoom: 'Drag up = zoom in, down = zoom out (pinch or Ctrl +/- too)',
    gMeasure: 'Tap two points - length in mm. Undo pt removes the last point',
    browseHint: 'drag / swipe to scroll through slices; pinch or Zoom tool to zoom; double-tap to zoom',
    emptyHint: 'Open your MRI, CT or ultrasound scan CD (.zip or .tar) or its folder - images stay on your device. No scan file yet? Download a demo below, then press "Open file" and pick the zip.',
    why: 'Written to open the author\'s own CT scan on a phone, then given away free to everyone - a gift from ClearEvo, no ads. The demo scans are his own head CT and MRI.',
    sourceLocal: 'local', sourceOnDevice: 'on your device', sourceRemote: 'streaming - nothing downloaded whole',
    downloadFull: 'download the full CD (GPL)', fastest: 'For fastest scrolling,', andOpenLocally: 'and open it locally.',
    loadingIndex: 'Reading scan index', parsing: 'Parsing index...', connecting: 'Connecting...',
    readingArchive: 'Reading archive index...', buffering: 'Buffering slice', loadingSlice: 'Loading...',
    notDevice: 'not a medical device: for personal viewing, not diagnosis',
    privacy: '100% in-browser - your medical images are NEVER uploaded', langName: 'EN' },
  th: {
    shareManual: 'คัดลอกลิงก์นี้:', pngSave: 'บันทึก', pngCancel: 'ยกเลิก',
    tsUnsupported: (ts) => `ยังไม่รองรับ transfer syntax ${ts} - แจ้งได้ที่ github.com/ykasidit/clearevo_online_tools`,
    archiveRefused: {
      gz: 'ไฟล์นี้ดูเป็น .gz / .tar.gz ซึ่ง gzip อ่านข้ามตำแหน่งไม่ได้ แผ่น CD ขนาดกิกะไบต์จึงต้องดาวน์โหลดและคลายทั้งก้อน กรุณาแตกเป็น .tar ธรรมดาหรือโฟลเดอร์ก่อน แล้วเปิดไฟล์นั้น',
      '7z': 'ไม่รองรับ .7z: การบีบอัดแบบ solid ทำให้อ่านทีละ slice ไม่ได้ กรุณาใช้ .zip, .tar ธรรมดา หรือโฟลเดอร์ของแผ่น CD ที่แตกแล้ว',
      rar: 'ไม่รองรับ .rar (ฟอร์แมตเฉพาะ ไม่มีตัวถอดรหัสที่ไลเซนส์เข้ากันได้) กรุณาใช้ .zip, .tar ธรรมดา หรือโฟลเดอร์ของแผ่น CD ที่แตกแล้ว',
      unknown: 'ไม่รู้จักไฟล์นี้ กรุณาใช้ .zip, .tar ธรรมดา หรือโฟลเดอร์ของแผ่น CD / ไฟล์ .dcm',
    },
    noDicom: 'ไม่พบภาพ DICOM - นี่เป็น zip หรือโฟลเดอร์ของแผ่น CD DICOM หรือไม่', scanning: (done, total) => `กำลังสแกน ${done}/${total}...`,
    seriesFound: (s, n) => `${s} ซีรีส์, ${n} ภาพ`, seriesIndexed: (s, n) => `${s} ซีรีส์, ${n} ภาพ (จากดัชนี)`,
    seriesStreaming: (s, n) => `${s} ซีรีส์, ${n} ภาพ (สตรีม) ถ้าอยากไล่ดูภาพให้ลื่นที่สุด ดาวน์โหลดทั้งแผ่นแล้วเปิดจากในเครื่อง`,
    dicomdirUnreadable: (m) => `อ่าน DICOMDIR ไม่ได้ (${m}) กำลังสแกนไฟล์แทน...`, cannotDisplay: (m) => `แสดงภาพไม่ได้: ${m}`,
    imgCount: (n) => `${n} ภาพ`, framesCount: (n) => `${n} เฟรม`, open: 'เปิดไฟล์', folder: 'เปิดโฟลเดอร์', cine: 'ซีเน', pause: 'พัก', capture: 'บันทึก PNG', captureAs: 'PNG ตั้งชื่อ…',
    pngPrompt: 'ตั้งชื่อไฟล์ PNG:', pngSaved: 'บันทึกแล้ว - ดูในโฟลเดอร์ดาวน์โหลด (Downloads)', pngFail: 'บันทึกไม่สำเร็จ: ',
    demoDl: 'เริ่มดาวน์โหลดสแกนตัวอย่างแล้ว (ดูในโฟลเดอร์ดาวน์โหลด) พอเสร็จ กดปุ่ม "เปิดไฟล์" ที่กะพริบ แล้วเลือกไฟล์ zip',
    loadingPreviews: 'กำลังโหลดตัวอย่างซีรีส์…', ready: 'พร้อมแล้ว', startReached: 'ต้นซีรีส์แล้ว', endReached: 'ท้ายซีรีส์แล้ว', frame: 'ภาพ', frames: 'ภาพ',
    demoSmall: '▶ ลองสแกนตัวอย่าง (150 MB) - CT หูที่เป็น SCDS จริง', demoCT: '⬇ แผ่น CT ตัวอย่างเต็มแผ่น (1.2 GB)', demoMRI: '⬇ แผ่น MRI ตัวอย่างเต็มแผ่น (870 MB)',
    share: '📤 แชร์เครื่องมือนี้', shareCopied: 'คัดลอกลิงก์แล้ว - วางส่งต่อได้เลย',
    browse: 'ดูภาพ', wl: 'W/L', pan: 'เลื่อนภาพ', zoom: 'Zoom', measure: 'วัดระยะ', undoPt: 'ลบจุด', reset: 'รีเซ็ต', invert: 'สลับขาว-ดำ', tags: 'Tags',
    wlSimple: 'ปรับแสง', playSimple: 'เล่น', captureSimple: 'บันทึกภาพ',
    modeSimple: 'แบบง่าย', modeAdvanced: 'ขั้นสูง',
    gWLSimple: 'ลากซ้าย-ขวา = ความคมชัด, ขึ้น-ลง = ความสว่าง',
    angle: 'มุม', rotate: 'หมุน', flip: 'พลิก',
    gAngle: 'แตะสามจุด - วัดมุมที่จุดกลาง',
    gBrowse: 'ปัด / ลากขึ้น-ลง เพื่อไล่ดู slice (ลูกกลิ้งเมาส์และ ◀ ▶ ก็ได้)',
    gWL: 'ลากซ้าย-ขวา = ความกว้างหน้าต่าง, ขึ้น-ลง = ระดับ',
    gPan: 'ลากเพื่อเลื่อนภาพ',
    gZoom: 'ลากขึ้น = ซูมเข้า, ลง = ซูมออก (สองนิ้วหุบ-ถ่าง หรือ Ctrl +/- ก็ได้)',
    gMeasure: 'แตะสองจุด = ระยะเป็น mm ปุ่มลบจุดจะลบจุดล่าสุด',
    browseHint: 'ลาก / ปัดเพื่อไล่ดู slice; ใช้สองนิ้วหุบ-ถ่าง หรือเครื่องมือ Zoom เพื่อซูม; แตะสองครั้งเพื่อซูม',
    emptyHint: 'เปิดแผ่น CD สแกน MRI, CT หรืออัลตราซาวด์ (.zip หรือ .tar) หรือโฟลเดอร์ของแผ่น - ภาพอยู่ในเครื่องคุณ ยังไม่มีไฟล์สแกน? ดาวน์โหลดตัวอย่างด้านล่าง เสร็จแล้วกด "เปิดไฟล์" แล้วเลือกไฟล์ zip',
    why: 'เขียนขึ้นเพื่อเปิดดูสแกน CT ของผู้พัฒนาเองบนมือถือ แล้วเปิดให้ทุกคนใช้ฟรีเป็นของขวัญจาก ClearEvo ไม่มีโฆษณา สแกนตัวอย่างคือ CT และ MRI ศีรษะของผู้พัฒนาเอง',
    sourceLocal: 'local', sourceOnDevice: 'อยู่ในเครื่องคุณ', sourceRemote: 'สตรีม - ไม่ได้ดาวน์โหลดทั้งไฟล์',
    downloadFull: 'ดาวน์โหลดทั้งแผ่น (GPL)', fastest: 'ถ้าอยากให้ไล่ดูภาพลื่นที่สุด', andOpenLocally: 'แล้วเปิดจากในเครื่อง',
    loadingIndex: 'กำลังอ่านรายการภาพสแกน', parsing: 'กำลังแปลงรายการภาพ...', connecting: 'กำลังเชื่อมต่อ...',
    readingArchive: 'กำลังอ่านรายการไฟล์...', buffering: 'กำลังโหลด slice', loadingSlice: 'กำลังโหลด...',
    notDevice: 'ไม่ใช่เครื่องมือแพทย์: สำหรับดูส่วนตัว ไม่ใช้วินิจฉัย',
    privacy: 'ทำงานในเบราว์เซอร์ของคุณ 100% - ภาพทางการแพทย์ของคุณไม่ถูกอัปโหลดออกไป', langName: 'ไทย' },
};
