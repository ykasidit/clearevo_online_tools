#!/usr/bin/env python3
# Generate the synthetic DICOM test data for the browser harness into data/:
# ct1..ct5.dcm - a 5-slice CT series, 256x256 16-bit, non-square PixelSpacing
#                [row=1.0, col=0.5] mm (catches row/col spacing swaps)
# us_clip.dcm  - a single multi-frame 8-bit "ultrasound clip", 128x128 x 8 frames
# Needs: pip install pydicom numpy
import numpy as np
import pydicom
from pathlib import Path
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

out = Path(__file__).parent / 'data'
out.mkdir(exist_ok=True)
study = generate_uid()


def base(modality):
    fm = FileMetaDataset()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian
    fm.MediaStorageSOPClassUID = pydicom.uid.CTImageStorage
    fm.MediaStorageSOPInstanceUID = generate_uid()
    ds = Dataset()
    ds.file_meta = fm
    ds.SOPClassUID = fm.MediaStorageSOPClassUID
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.PatientName = 'Repro^Test'
    ds.PatientID = 'R1'
    ds.Modality = modality
    ds.StudyInstanceUID = study
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.PixelRepresentation = 0
    return ds


serA = generate_uid()
y, x = np.mgrid[0:256, 0:256]
for i in range(5):
    ds = base('CT')
    ds.SeriesInstanceUID = serA
    ds.SeriesNumber = 1
    ds.InstanceNumber = i + 1
    ds.SeriesDescription = 'AX BRAIN test'
    ds.Rows = 256
    ds.Columns = 256
    ds.PixelSpacing = [1.0, 0.5]
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.WindowCenter = 2048
    ds.WindowWidth = 4096
    ds.PixelData = (((x * 8 + y * 8) + i * 400) % 4096).astype('<u2').tobytes()
    pydicom.dcmwrite(out / f'ct{i + 1}.dcm', ds, write_like_original=False)

ds = base('US')
ds.SeriesInstanceUID = generate_uid()
ds.SeriesNumber = 2
ds.InstanceNumber = 1
ds.SeriesDescription = 'US clip test'
ds.Rows = 128
ds.Columns = 128
ds.BitsAllocated = 8
ds.BitsStored = 8
ds.HighBit = 7
ds.NumberOfFrames = 8
ds.FrameTime = '100'
frames = []
for k in range(8):
    f = np.zeros((128, 128), np.uint8)
    f[:, k * 16:(k + 1) * 16] = 255
    frames.append(f.tobytes())
ds.PixelData = b''.join(frames)
pydicom.dcmwrite(out / 'us_clip.dcm', ds, write_like_original=False)
print(f'wrote 6 test DICOMs -> {out}')
