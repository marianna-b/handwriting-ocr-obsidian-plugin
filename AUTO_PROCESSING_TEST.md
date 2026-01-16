# Auto-Processing Feature - Testing Guide

## Setup

1. **Configure API Key**
   - Go to plugin settings
   - Enter your Handwriting OCR API key
   - Click "Validate" to verify

2. **Enable Auto-Processing**
   - In plugin settings, scroll to "Automatic Processing" section
   - Toggle "Enable automatic processing" ON
   - Set "Watch folder" to a folder in your vault (e.g., "Inbox")
   - Choose "Auto-processing action":
     - "Create new note" - creates separate OCR note for each file
     - "Append to source note" - creates/appends to companion .md file

## Test Scenarios

### Test 1: New File Processing
1. Create the watch folder (e.g., "Inbox") in your vault if it doesn't exist
2. Copy or drag a supported image/PDF file into the watch folder
3. **Expected**: 
   - Notice appears: "Auto-processing: [filename]"
   - File is processed automatically
   - Output created based on action setting
   - Hidden metadata file created: `.filename.ext.ocr-processed`

### Test 2: Already Processed File
1. After Test 1 completes, modify the same file (e.g., add metadata, resize image)
2. Wait a moment
3. **Expected**:
   - File is NOT reprocessed (hash matches)
   - No notice appears

### Test 3: Modified File Reprocessing
1. Actually change the file content (replace with different image)
2. **Expected**:
   - File IS reprocessed (hash changed)
   - Notice appears
   - New output created

### Test 4: Queue Management
1. Drop multiple files (3-5) into watch folder at once
2. **Expected**:
   - Files are processed sequentially (one at a time)
   - Each file gets a processing notice
   - No concurrent API calls

### Test 5: Error Handling
1. Test with invalid API key or insufficient credits
2. **Expected**:
   - Error notice appears
   - Metadata file created with status: "error"
   - Queue continues processing other files

### Test 6: Disable Auto-Processing
1. Toggle "Enable automatic processing" OFF in settings
2. Drop new file in watch folder
3. **Expected**:
   - No automatic processing
   - File remains unprocessed

### Test 7: Append to Source Action
1. Set action to "Append to source note"
2. Drop `test.pdf` into watch folder
3. **Expected**:
   - Creates/updates `test.md` in same folder
   - OCR content appended to note
   - Link to source file included

## Metadata Files

After processing, check for hidden metadata files:
- Location: Same folder as source file
- Name: `.{original-filename}.ocr-processed`
- Format: JSON with fields:
  - `processedAt`: timestamp
  - `fileHash`: mtime-size hash
  - `status`: "success" or "error"
  - `errorMessage`: (if error occurred)

## Debugging

If auto-processing doesn't work:
1. Check browser/developer console for errors
2. Verify watch folder path is correct
3. Verify file type is supported (jpg, png, pdf, etc.)
4. Check file size < 20MB
5. Ensure API key is valid
6. Check credit balance

## Supported File Types

- Images: JPG, JPEG, PNG, GIF, BMP, TIFF, TIF, HEIC, WEBP
- Documents: PDF
- Max size: 20MB
