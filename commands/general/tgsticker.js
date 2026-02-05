/**
 * Telegram Sticker Command
 * Download and convert Telegram sticker packs to WhatsApp stickers
 */

const axios = require('axios');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const crypto = require('crypto');
const webp = require('node-webpmux');
const ffmpegPath = require('ffmpeg-static');
const config = require('../../config');
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

// Delay helper function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Telegram bot tokens (try snippet token first, fallback to original)
const BOT_TOKEN_PRIMARY = '891038791:AAHWB1dQd-vi0IbH2NjKYUk-hqQ8rQuzPD4';
const BOT_TOKEN_FALLBACK = '7801479976:AAGuPL0a7kXXBYz6XUSR_ll2SR5V_W6oHl4';

module.exports = {
  name: 'tgsticker',
  aliases: ['tg', 'tgs', 'telegramsticker'],
  category: 'general',
  description: 'Download and convert Telegram sticker pack to WhatsApp stickers',
  usage: '.tgsticker <telegram_sticker_url>',
  
  async execute(sock, msg, args, extra) {
    try {
      // Get the URL from message
      const text = msg.message?.conversation?.trim() || 
                  msg.message?.extendedTextMessage?.text?.trim() || '';
      
      const urlArgs = text.split(' ').slice(1);
      
      if (!urlArgs[0]) {
        return extra.reply('⚠️ Please enter the Telegram sticker URL!\n\nExample: .tgsticker https://t.me/addstickers/Porcientoreal');
      }

      // Validate URL format
      if (!urlArgs[0].match(/(https:\/\/t.me\/addstickers\/)/gi)) {
        return extra.reply('❌ Invalid URL! Make sure it\'s a Telegram sticker URL.\n\nExample: https://t.me/addstickers/Porcientoreal');
      }

      // Get pack name from URL
      const packName = urlArgs[0].replace("https://t.me/addstickers/", "").trim();
      
      if (!packName) {
        return extra.reply('❌ Could not extract sticker pack name from URL.');
      }

      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:54',message:'Before API call',data:{packName,encodedPackName:encodeURIComponent(packName)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // Get sticker pack using Telegram Bot API (like Telesticker function)
        // Try primary token first, fallback to secondary if 401
        let data;
        let BOT_TOKEN = BOT_TOKEN_PRIMARY;
        
        try {
          const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getStickerSet?name=${encodeURIComponent(packName)}`;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:62',message:'Trying primary token',data:{tokenPrefix:BOT_TOKEN.substring(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          data = await axios(apiUrl, {
            method: "GET",
            headers: {"User-Agent": "GoogleBot"}
          });
        } catch (primaryError) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:72',message:'Primary token failed, trying fallback',data:{primaryError:primaryError?.response?.status,primaryErrorDesc:primaryError?.response?.data?.description},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          
          // If 401, try fallback token
          if (primaryError?.response?.status === 401) {
            BOT_TOKEN = BOT_TOKEN_FALLBACK;
            const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getStickerSet?name=${encodeURIComponent(packName)}`;
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:78',message:'Trying fallback token',data:{tokenPrefix:BOT_TOKEN.substring(0,10)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            data = await axios(apiUrl, {
              method: "GET",
              headers: {"User-Agent": "GoogleBot"}
            });
          } else {
            throw primaryError;
          }
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:68',message:'API response received',data:{status:data?.status,hasData:!!data?.data,ok:data?.data?.ok,errorCode:data?.data?.error_code,errorDesc:data?.data?.description?.substring(0,50),stickerCount:data?.data?.result?.stickers?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        if (!data.data || !data.data.result || !data.data.result.stickers || data.data.result.stickers.length === 0) {
          throw new Error('Sticker pack not found or empty');
        }

        const stickerSet = data.data.result;
        
        // Send initial message with sticker count
        await extra.reply(`📦 Found ${stickerSet.stickers.length} stickers\n⏳ Starting download...`);

        // Get temp directory
        const tempDir = getTempDir();

        // Process each sticker
        let successCount = 0;
        let tgsCount = 0;
        const tempFiles = [];
        
        for (let i = 0; i < stickerSet.stickers.length; i++) {
          try {
            const sticker = stickerSet.stickers[i];
            
            // Check if sticker is animated FIRST
            const isAnimatedSticker = sticker.is_animated || sticker.is_video || sticker.animated;
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:122',message:'Sticker info',data:{stickerIndex:i+1,isAnimated:isAnimatedSticker,hasThumb:!!sticker.thumb,hasFileId:!!sticker.file_id,stickerType:sticker.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // Get file_id from sticker
            // For animated stickers, use file_id directly (not thumb)
            // For static stickers, use thumb.file_id if available, otherwise file_id
            let fileId;
            if (isAnimatedSticker) {
              fileId = sticker.file_id; // Animated stickers need the actual file_id, not thumb
            } else {
              fileId = sticker.thumb ? sticker.thumb.file_id : sticker.file_id;
            }
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:135',message:'File ID selected',data:{stickerIndex:i+1,fileId:fileId?.substring(0,20)+'...',isAnimated:isAnimatedSticker,usedThumb:!isAnimatedSticker && !!sticker.thumb},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            if (!fileId) {
              console.error(`No file_id found for sticker ${i + 1}`);
              continue;
            }
            
            // Get file path from Telegram API (use the same token that worked) with retry
            let fileData = null;
            const maxGetFileRetries = 3;
            let getFileRetryCount = 0;
            
            while (getFileRetryCount < maxGetFileRetries && !fileData) {
              try {
                fileData = await axios(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`, {
                  method: "GET",
                  headers: {"User-Agent": "GoogleBot"},
                  timeout: 30000
                });
                
                if (!fileData.data || !fileData.data.result || !fileData.data.result.file_path) {
                  throw new Error('Invalid file data response');
                }
                break; // Success, exit retry loop
              } catch (error) {
                getFileRetryCount++;
                if (getFileRetryCount < maxGetFileRetries) {
                  const waitTime = Math.min(1000 * Math.pow(2, getFileRetryCount - 1), 5000);
                  console.log(`Retry ${getFileRetryCount}/${maxGetFileRetries} for getFile ${i + 1} after ${waitTime}ms...`);
                  await delay(waitTime);
                } else {
                  console.error(`Failed to get file info for sticker ${i + 1} after ${maxGetFileRetries} attempts:`, error.message);
                  continue; // Skip this sticker
                }
              }
            }
            
            if (!fileData || !fileData.data || !fileData.data.result || !fileData.data.result.file_path) {
              console.error(`Invalid file data for sticker ${i + 1}`);
              continue;
            }

            // Download sticker from Telegram file API (use the same token that worked)
            const stickerUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.data.result.file_path}`;
            
            // Retry logic for network requests
            let imageBuffer = null;
            let imageResponse = null;
            const maxDownloadRetries = 3;
            let downloadRetryCount = 0;
            
            while (downloadRetryCount < maxDownloadRetries && !imageBuffer) {
              try {
                imageResponse = await fetch(stickerUrl, {
                  timeout: 30000, // 30 second timeout
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                  }
                });
                
                if (!imageResponse.ok) {
                  throw new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`);
                }
                
                imageBuffer = await imageResponse.buffer();
                break; // Success, exit retry loop
              } catch (error) {
                downloadRetryCount++;
                if (downloadRetryCount < maxDownloadRetries) {
                  const waitTime = Math.min(1000 * Math.pow(2, downloadRetryCount - 1), 5000); // Exponential backoff, max 5s
                  console.log(`Retry ${downloadRetryCount}/${maxDownloadRetries} for sticker ${i + 1} after ${waitTime}ms...`);
                  await delay(waitTime);
                } else {
                  console.error(`Failed to download sticker ${i + 1} after ${maxDownloadRetries} attempts:`, error.message);
                  throw error;
                }
              }
            }
            
            if (!imageBuffer) {
              console.error(`Failed to download sticker ${i + 1} after all retries`);
              continue;
            }

            // Get file extension from file_path
            const filePath = fileData.data.result.file_path;
            let fileExtension = path.extname(filePath).toLowerCase();
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:160',message:'File info',data:{stickerIndex:i+1,filePath,fileExtension,isAnimatedSticker,bufferSize:imageBuffer.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // If no extension found, try to detect from buffer or default to .webp
            if (!fileExtension) {
              // Check buffer magic bytes
              if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) {
                fileExtension = '.webp'; // WebP format
              } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
                fileExtension = '.png'; // PNG format
              } else {
                fileExtension = '.webp'; // Default to webp
              }
            }

            // Check if sticker is animated or video (use the isAnimatedSticker we detected earlier)
            // Note: .tgs files are Lottie format, but Telegram API usually provides animated WebP for animated stickers
            const isAnimated = isAnimatedSticker;
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:175',message:'Animation detection',data:{stickerIndex:i+1,isAnimated,isAnimatedSticker,fileExtension,willBeAnimated:isAnimated},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion

            // Generate temp file paths with proper extension
            const timestamp = Date.now();
            const tempInput = path.join(tempDir, `tg_input_${timestamp}_${i}${fileExtension}`);
            const tempOutput = path.join(tempDir, `tg_sticker_${timestamp}_${i}.webp`);
            
            tempFiles.push(tempInput, tempOutput);

            // Write media to temp file
            fs.writeFileSync(tempInput, imageBuffer);
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:207',message:'File written to temp',data:{stickerIndex:i+1,fileExtension,isAnimated,fileSize:imageBuffer.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // ✅ Handle Telegram animated stickers (.tgs) - convert to animated WebP
            if (fileExtension === '.tgs') {
              try {
                // Decompress .tgs (it's gzipped JSON)
                const decompressed = zlib.gunzipSync(imageBuffer);
                const lottieData = JSON.parse(decompressed.toString('utf8'));
                
                // Get animation properties
                const fps = lottieData.fr || 30;
                const width = lottieData.w || 512;
                const height = lottieData.h || 512;
                const startFrame = lottieData.ip || 0;
                const endFrame = lottieData.op || 60;
                const totalFrames = endFrame - startFrame;
                
                // Use tgs-to package to convert .tgs to WebP
                const TGS = require('tgs-to');
                const tgsPath = path.join(tempDir, `tgs_${timestamp}_${i}.tgs`);
                const tgsOutput = path.join(tempDir, `tgs_${timestamp}_${i}.webp`);
                
                tempFiles.push(tgsPath, tgsOutput);
                
                // Write .tgs file temporarily
                fs.writeFileSync(tgsPath, imageBuffer);
                
                // Convert using tgs-to - convert to GIF first for better compression control
                const tgs = new TGS(tgsPath);
                const gifPath = path.join(tempDir, `tgs_${timestamp}_${i}.gif`);
                tempFiles.push(gifPath);
                
                // Convert to GIF first
                await tgs.convertToGif(gifPath);
                
                if (!fs.existsSync(gifPath)) {
                  throw new Error('GIF conversion output file not found');
                }
                
                const MAX_SIZE = 1024 * 1024; // 1MB
                
                // Convert GIF to WebP with compression, try different quality levels
                const qualityLevels = [75, 60, 50, 40, 30, 25, 20];
                let webpBuffer = null;
                let finalOutput = tgsOutput;
                
                for (const quality of qualityLevels) {
                  const ffmpegCmd = `"${ffmpegPath}" -i "${gifPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -loop 0 -fps_mode vfr -pix_fmt yuva420p -quality ${quality} -compression_level 6 "${finalOutput}"`;
                  
                  try {
                    await new Promise((resolve, reject) => {
                      exec(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                        if (error) {
                          // Log but don't fail on first attempts
                          if (quality > 30) {
                            reject(error);
                          } else {
                            resolve(); // Continue to next quality
                          }
                        } else {
                          resolve();
                        }
                      });
                    });
                    
                    if (fs.existsSync(finalOutput)) {
                      const fileSize = fs.statSync(finalOutput).size;
                      if (fileSize <= MAX_SIZE) {
                        webpBuffer = fs.readFileSync(finalOutput);
                        console.log(`Sticker ${i + 1} converted to ${(fileSize / 1024).toFixed(2)}KB with quality ${quality}`);
                        break;
                      } else if (quality <= 25) {
                        // If still too large at low quality, try reducing FPS
                        const reducedFpsOutput = path.join(tempDir, `tgs_reduced_${timestamp}_${i}.webp`);
                        tempFiles.push(reducedFpsOutput);
                        
                        const reduceFpsCmd = `"${ffmpegPath}" -i "${gifPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,fps=10" -c:v libwebp -loop 0 -fps_mode vfr -pix_fmt yuva420p -quality 20 -compression_level 6 "${reducedFpsOutput}"`;
                        
                        await new Promise((resolve, reject) => {
                          exec(reduceFpsCmd, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
                            if (error) reject(error);
                            else resolve();
                          });
                        });
                        
                        if (fs.existsSync(reducedFpsOutput)) {
                          const reducedSize = fs.statSync(reducedFpsOutput).size;
                          if (reducedSize <= MAX_SIZE) {
                            webpBuffer = fs.readFileSync(reducedFpsOutput);
                            finalOutput = reducedFpsOutput;
                            console.log(`Sticker ${i + 1} compressed to ${(reducedSize / 1024).toFixed(2)}KB with reduced FPS`);
                            break;
                          }
                        }
                      }
                    }
                  } catch (error) {
                    // Continue to next quality level
                    continue;
                  }
                }
                
                // If still no buffer, use the last attempt or original
                if (!webpBuffer) {
                  if (fs.existsSync(finalOutput)) {
                    webpBuffer = fs.readFileSync(finalOutput);
                    const fileSize = webpBuffer.length;
                    if (fileSize > MAX_SIZE) {
                      console.warn(`Sticker ${i + 1} is ${(fileSize / 1024).toFixed(2)}KB (exceeds 1MB), sending anyway`);
                    }
                  } else {
                    throw new Error('WebP conversion failed');
                  }
                }
                
                // Add WhatsApp metadata
                const img = new webp.Image();
                await img.load(webpBuffer);
                
                const metadata = {
                  'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
                  'sticker-pack-name': config.packname || 'Knight Bot',
                  'emojis': (sticker.emoji && Array.isArray(sticker.emoji) ? sticker.emoji : [sticker.emoji || '🤖']).filter(Boolean)
                };
                
                const exifAttr = Buffer.from([
                  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
                  0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
                ]);
                
                const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
                const exif = Buffer.concat([exifAttr, jsonBuffer]);
                exif.writeUIntLE(jsonBuffer.length, 14, 4);
                
                img.exif = exif;
                const finalBuffer = await img.save(null);
                
                // Final size check
                if (finalBuffer.length > MAX_SIZE) {
                  console.warn(`Sticker ${i + 1} final size: ${(finalBuffer.length / 1024).toFixed(2)}KB (exceeds 1MB limit)`);
                }
                
                // Send as sticker
                await sock.sendMessage(extra.from, { 
                  sticker: finalBuffer 
                });
                
                successCount++;
                await delay(1000);
                
                // Cleanup
                try {
                  deleteTempFile(tempInput);
                  deleteTempFile(tgsPath);
                  deleteTempFile(gifPath);
                  deleteTempFile(tgsOutput);
                  // Cleanup any compression temp files
                  const compressedFile = path.join(tempDir, `tgs_compressed_${timestamp}_${i}.webp`);
                  const reducedFile = path.join(tempDir, `tgs_reduced_${timestamp}_${i}.webp`);
                  if (fs.existsSync(compressedFile)) deleteTempFile(compressedFile);
                  if (fs.existsSync(reducedFile)) deleteTempFile(reducedFile);
                } catch (err) {
                  console.error('Error cleaning up .tgs temp files:', err);
                }
                
                continue; // Move to next sticker
              } catch (error) {
                console.error(`Error converting .tgs sticker ${i + 1}:`, error);
                // Fallback: try direct WebP conversion (no compression)
                try {
                  const tgs = new TGS(tgsPath);
                  await tgs.convertToWebp(tgsOutput);
                  
                  if (fs.existsSync(tgsOutput)) {
                    const webpBuffer = fs.readFileSync(tgsOutput);
                    
                    // Add metadata and send
                    const img = new webp.Image();
                    await img.load(webpBuffer);
                    
                    const metadata = {
                      'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
                      'sticker-pack-name': config.packname || 'Knight Bot',
                      'emojis': (sticker.emoji && Array.isArray(sticker.emoji) ? sticker.emoji : [sticker.emoji || '🤖']).filter(Boolean)
                    };
                    
                    const exifAttr = Buffer.from([
                      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
                      0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
                    ]);
                    
                    const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
                    const exif = Buffer.concat([exifAttr, jsonBuffer]);
                    exif.writeUIntLE(jsonBuffer.length, 14, 4);
                    
                    img.exif = exif;
                    const finalBuffer = await img.save(null);
                    
                    await sock.sendMessage(extra.from, { 
                      sticker: finalBuffer 
                    });
                    
                    successCount++;
                    await delay(1000);
                    
                    try {
                      deleteTempFile(tempInput);
                      deleteTempFile(tgsPath);
                      deleteTempFile(tgsOutput);
                    } catch (err) {
                      console.error('Error cleaning up .tgs fallback files:', err);
                    }
                    
                    continue;
                  }
                } catch (fallbackError) {
                  console.error(`Fallback conversion also failed for sticker ${i + 1}:`, fallbackError);
                }
                
                // Last resort: send as document only if all conversions fail
                console.log(`Sending sticker ${i + 1} as .tgs document (all conversions failed)`);
                const tgsDocPath = path.join(tempDir, `telegram_animated_${timestamp}_${i}.tgs`);
                fs.writeFileSync(tgsDocPath, imageBuffer);
                
                await sock.sendMessage(extra.from, {
                  document: fs.readFileSync(tgsDocPath),
                  mimetype: 'application/x-tgsticker',
                  fileName: `${packName}_${i + 1}.tgs`
                });
                
                successCount++;
                tgsCount++;
                await delay(700);
                
                try {
                  deleteTempFile(tgsDocPath);
                  deleteTempFile(tempInput);
                } catch (err) {
                  console.error('Error cleaning up .tgs document files:', err);
                }
                
                continue;
              }
            }
            
            // Check if file is already WebP (static or animated)
            if (fileExtension === '.webp') {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:214',message:'Processing WebP file',data:{stickerIndex:i+1,fileExtension,isAnimated,willPreserveAnimation:isAnimated},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              
              // For WebP files (both static and animated), add metadata while preserving animation
              const img = new webp.Image();
              await img.load(imageBuffer);

              // Create metadata
              const metadata = {
                'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
                'sticker-pack-name': config.packname || 'Knight Bot',
                'emojis': (sticker.emoji && Array.isArray(sticker.emoji) ? sticker.emoji : [sticker.emoji || '🤖']).filter(Boolean)
              };

              // Create exif buffer
              const exifAttr = Buffer.from([
                0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
              ]);
              
              const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
              const exif = Buffer.concat([exifAttr, jsonBuffer]);
              exif.writeUIntLE(jsonBuffer.length, 14, 4);

              img.exif = exif;
              // save(null) preserves animation for animated WebP
              const finalBuffer = await img.save(null);

              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:243',message:'WebP processed',data:{stickerIndex:i+1,originalSize:imageBuffer.length,finalSize:finalBuffer.length,isAnimated},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion

              // Send sticker
              await sock.sendMessage(extra.from, { 
                sticker: finalBuffer 
              });

              successCount++;
              await delay(1000);

              // Cleanup
              try {
                deleteTempFile(tempInput);
              } catch (err) {
                console.error('Error cleaning up temp files:', err);
              }
              
              continue; // Skip ffmpeg conversion for WebP files
            }

            // Convert to WebP using ffmpeg with optimized settings
            // Use fps_mode instead of deprecated vsync
            const ffmpegCommand = isAnimated
              ? `"${ffmpegPath}" -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -fps_mode vfr -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
              : `"${ffmpegPath}" -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -fps_mode vfr -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;

            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:425',message:'Starting FFmpeg conversion',data:{stickerIndex:i+1,isAnimated,fileExtension},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion

            await new Promise((resolve, reject) => {
              exec(ffmpegCommand, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:432',message:'FFmpeg error',data:{stickerIndex:i+1,errorMessage:error.message,stderr:stderr?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                  console.error(`FFmpeg error for sticker ${i + 1}:`, error.message);
                  // Log stderr for debugging
                  if (stderr) {
                    console.error('FFmpeg stderr:', stderr.substring(0, 500));
                  }
                  reject(error);
                } else {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:441',message:'FFmpeg success',data:{stickerIndex:i+1,isAnimated},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                  // #endregion
                  resolve();
                }
              });
            });

            // Read the WebP file
            if (!fs.existsSync(tempOutput)) {
              console.error(`FFmpeg output file not found for sticker ${i + 1}`);
              continue;
            }
            
            const webpBuffer = fs.readFileSync(tempOutput);

            // Add metadata using webpmux
            const img = new webp.Image();
            await img.load(webpBuffer);

            // Create metadata (matching sticker.js pattern)
            const metadata = {
              'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
              'sticker-pack-name': config.packname || 'Knight Bot',
              'emojis': (sticker.emoji && Array.isArray(sticker.emoji) ? sticker.emoji : [sticker.emoji || '🤖']).filter(Boolean)
            };

            // Create exif buffer (matching sticker.js pattern)
            const exifAttr = Buffer.from([
              0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
              0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
            ]);
            
            const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
            const exif = Buffer.concat([exifAttr, jsonBuffer]);
            exif.writeUIntLE(jsonBuffer.length, 14, 4);

            // Set the exif data
            img.exif = exif;

            // Get the final buffer
            const finalBuffer = await img.save(null);

            // Send sticker
            await sock.sendMessage(extra.from, { 
              sticker: finalBuffer 
            });

            successCount++;
            
            // Delay before next sticker (1 second)
            await delay(1000);

            // Cleanup temp files for this sticker
            try {
              deleteTempFile(tempInput);
              deleteTempFile(tempOutput);
            } catch (err) {
              console.error('Error cleaning up temp files:', err);
            }

          } catch (err) {
            console.error(`Error processing sticker ${i + 1}:`, err);
            continue;
          }
        }

        // Send completion message
        if (tgsCount > 0) {
          await extra.reply(
            `✅ Done\n` +
            `• Stickers sent: ${successCount}/${stickerSet.stickers.length}\n` +
            `• Note: Animated Telegram stickers (${tgsCount}) were sent as files (.tgs)`
          );
        } else {
          await extra.reply(`✅ Successfully downloaded ${successCount}/${stickerSet.stickers.length} stickers!`);
        }

      } catch (error) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/44c87b60-b6ab-47d5-9224-5cb012ce57ee',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tgsticker.js:415',message:'Error caught',data:{errorMessage:error?.message,errorCode:error?.code,status:error?.response?.status,statusText:error?.response?.statusText,responseData:error?.response?.data,hasResponse:!!error?.response},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.error('Error in tgsticker command:', error);
        throw new Error(`Failed to process sticker pack: ${error.message}`);
      }

    } catch (error) {
      console.error('Error in tgsticker command:', error);
      await extra.reply('❌ Failed to process Telegram stickers!\n\nMake sure:\n1. The URL is correct\n2. The sticker pack exists\n3. The sticker pack is public\n\nError: ' + error.message);
    }
  }
};

