// Ambient declarations for the type check in JS mode (tsc --checkJs, test/dicom_typecheck.test.js): the two vendored
// decoders the DICOM viewer loads as classic scripts. Not deployed; the editor picks it up through tsconfig.json.
declare var dicomParser: any;
declare var OpenJPEGWASM: any;
