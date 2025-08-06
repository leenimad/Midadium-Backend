//backend/contollers/lessonController.js
const mongoose = require('mongoose');
const Lesson = require('../models/LessonModel');
const Course = require('../models/courseModel');
const User = require('../models/UserModel');
 const Enrollment=require('../models/EnrollmentModel');
const GeneratedContent = require('../models/GeneratedContentModel');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');
const axios = require('axios'); // For AssemblyAI
const { createNotification } = require('./notificationController');
// const FormData = require('form-data'); // Not strictly needed if axios handles stream for AssemblyAI
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");


const audioDir = path.join(__dirname, '../uploads/audio');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

try {
 // for leen
// const ffmpegPath = process.env.FFMPEG_PATH || 'C:/ffmpeg/bin/ffmpeg.exe'; 
 const ffmpegPath = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg'; // ADJUST YOUR FALLBAC
  console.log(`Attempting to use FFMPEG path: ${ffmpegPath}`);
  if (fs.existsSync(ffmpegPath)) {
      ffmpeg.setFfmpegPath(ffmpegPath);
  } else if (!process.env.FFMPEG_PATH) {
      console.warn("Warning: Default FFMPEG path does not exist and FFMPEG_PATH env var not set. Ensure ffmpeg is in system PATH.");
  } else {
       console.warn(`Warning: FFMPEG path from env var not found: ${ffmpegPath}.`);
  }
} catch (err) { console.error("Error setting FFMPEG path:", err); }

let genAI; // Google Gemini Client
if (process.env.GEMINI_API_KEY) {
  try {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      console.log("Google Generative AI client initialized.");
  } catch (e) { console.error("Failed to initialize Google Generative AI client:", e); genAI = null; }
} else { console.warn("GEMINI_API_KEY env var not set."); genAI = null; }

// Audio Extraction Helper
const extractAudio = (videoPath, audioOutputPath) => {
    return new Promise((resolve, reject) => {
        console.log(`FFMPEG: Starting audio extraction from ${videoPath} to ${audioOutputPath}`);
        ffmpeg(videoPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('128k')
            .output(audioOutputPath)
            .on('progress', (progress) => {
                if (Math.round(progress.percent) % 20 === 0) {
                    console.log('FFMPEG Progress: ' + Math.round(progress.percent) + '% done');
                }
            })
            .on('end', () => {
                console.log(`FFMPEG: Audio extraction finished: ${audioOutputPath}`);
                resolve();
            })
            .on('error', (err) => {
                console.error(`FFMPEG: Error extracting audio: ${err.message}`);
                fs.unlink(audioOutputPath, (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                        console.error(`Error deleting partial audio file ${audioOutputPath}:`, unlinkErr);
                    }
                });
                reject(new Error(`FFMPEG Error: ${err.message}`));
            })
            .run();
    });
};


const axiosAssemblyTranscription = async (audioFilePath) => {
    const uploadUrl = 'https://api.assemblyai.com/v2/upload';
    const transcriptUrl = 'https://api.assemblyai.com/v2/transcript';
    const API_KEY = process.env.ASSEMBLY_API_KEY;
    if (!API_KEY) {
        throw new Error("ASSEMBLY_API_KEY environment variable not set. Transcription cannot proceed.");
    }

    try {
        
        console.log(`[ASSEMBLYAI] Uploading audio file: ${audioFilePath}`);
        const audioStream = fs.createReadStream(audioFilePath);
        const uploadResponse = await axios({
            method: 'post',
            url: uploadUrl,
            headers: {
                'authorization': API_KEY,
                'transfer-encoding': 'chunked'
            },
            data: audioStream,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        const audioUrl = uploadResponse.data.upload_url;
        console.log(`[ASSEMBLYAI] File uploaded successfully. Received audio URL: ${audioUrl}`);

        
        console.log(`[ASSEMBLYAI] Requesting transcription...`);
        const transcriptResponse = await axios.post(
            transcriptUrl,
            { audio_url: audioUrl },
            { headers: { 'authorization': API_KEY } }
        );
        const transcriptId = transcriptResponse.data.id;
        console.log(`[ASSEMBLYAI] Transcription requested. Transcript ID: ${transcriptId}`);

        
        let pollingResponse;
        const pollInterval = 5000; // 5 seconds interval
        while (true) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            pollingResponse = await axios.get(`${transcriptUrl}/${transcriptId}`, {
                headers: { 'authorization': API_KEY }
            });
            const status = pollingResponse.data.status;
            console.log(`[ASSEMBLYAI] Polling status: ${status}`);
            if (status === 'completed') break;
            if (status === 'error') {
                throw new Error(`AssemblyAI transcription failed: ${pollingResponse.data.error}`);
            }
        }

        console.log(`[ASSEMBLYAI] Transcription completed successfully.`);
        return pollingResponse.data; // Should contain transcription text in pollingResponse.data.text
    } catch (error) {
        console.error(`[ASSEMBLYAI] Transcription failed: ${error.message}`);
        throw error;
    }
};
// Transcribe Lesson Audio using AssemblyAI
const transcribeLessonAudio = async (lessonId) => {
  console.log(`[TRANSCRIPTION - AssemblyAI] Starting for Lesson ${lessonId}`);
  let lesson;
  let audioPath;
  const API_KEY = process.env.ASSEMBLY_API_KEY; // Use ASSEMBLY_API_KEY

  if (!API_KEY) {
      const msg = "ASSEMBLY_API_KEY is not set. Transcription cannot proceed.";
      console.error(`[TRANSCRIPTION] ${msg}`);
      await Lesson.findByIdAndUpdate(lessonId, { status: 'error', errorMessage: msg }).catch(e => console.error("DB Error:", e));
      throw new Error(msg);
  }

  try {
      lesson = await Lesson.findById(lessonId);
      if (!lesson || !lesson.audioPath) {
          throw new Error(`Lesson ${lessonId} or its audio path not found for transcription.`);
      }
      audioPath = lesson.audioPath;
      console.log(`[TRANSCRIPTION] Checking audio file: ${audioPath}`);
      await fsPromises.access(audioPath);
      console.log(`[ASSEMBLYAI] Uploading audio file and transcribing...`);

      const transcriptionData = await axiosAssemblyTranscription(audioPath); // Call your helper

      if (!transcriptionData || typeof transcriptionData.text !== 'string') {
          throw new Error('AssemblyAI transcription response did not contain valid text.');
      }
      console.log(`[TRANSCRIPTION] Received transcript (length: ${transcriptionData.text.length}). Saving to DB...`);
      await Lesson.findByIdAndUpdate(lessonId, {
          transcript: transcriptionData.text,
          status: 'ready', // Mark lesson as ready for AI format generation
          errorMessage: null
      });
      console.log(`[TRANSCRIPTION] Lesson ${lessonId} status updated to 'ready'.`);
      await fsPromises.unlink(audioPath).catch(e => console.error(`[TRANSCRIPTION] Error deleting audio ${audioPath}:`, e));
      console.log(`[TRANSCRIPTION] Finished successfully for Lesson ${lessonId}.`);
  } catch (error) {
      console.error(`[TRANSCRIPTION - AssemblyAI] ERROR for Lesson ${lessonId}:`, error.message);
      let errorMessageContent = `Transcription failed: ${error.message || 'Unknown AssemblyAI error'}`;
      if (error.response?.data?.error) { errorMessageContent = `Transcription failed: ${error.response.data.error}`; }
      try {
          await Lesson.findByIdAndUpdate(lessonId, { status: 'error', errorMessage: errorMessageContent.substring(0, 500) });
          console.log(`[TRANSCRIPTION] Lesson ${lessonId} status updated to 'error'.`);
      } catch (dbError) { console.error(`CRITICAL: Failed to update lesson status for ${lessonId}:`, dbError); }
      if (audioPath) { await fsPromises.unlink(audioPath).catch(e => { if (e.code !== 'ENOENT') console.error("Error deleting audio after failure:", e); });}
  }
};

// --- CONTROLLER FUNCTIONS ---
// Leen's Working uploadfunction
/*const uploadLesson = async (req, res) => {
  // Files are now in req.files (e.g., req.files.video[0], req.files.pdf[0])
  const videoFile = req.files?.video?.[0]; // Optional chaining
  const pdfFile = req.files?.pdf?.[0];   // Optional chaining

  const absoluteVideoPath = videoFile?.path; // e.g., C:\Users\USER\MidadiumProject\backend\uploads\videos\filename.mp4
    const absolutePdfPath = pdfFile?.path;

  const actorId = req.user?.id;
  const actorUsername = req.user?.username;

  try {
      const { title, objectives, keywords, courseId } = req.body;
      const teacherId = req.user?.id;

      // --- Input Validation ---
      if (!videoFile && !pdfFile) { // Check if at least one file is uploaded (or adjust if files are optional)
          return res.status(400).json({ message: 'No video or PDF file uploaded.' });
      }
      if (!title || !objectives || !courseId) {
           // Cleanup uploaded files if metadata is missing
           if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
           if (absolutePdfPath) await fsPromises.unlink(absolutePdfPath).catch(console.error);
          return res.status(400).json({ message: 'Missing required fields: title, objectives, courseId.' });
      }
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
           if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
           if (absolutePdfPath) await fsPromises.unlink(absolutePdfPath).catch(console.error);
          return res.status(400).json({ message: 'Invalid Course ID format.' });
      }
      if (!teacherId) { throw new Error('Authentication error: Teacher ID missing.'); } // Should be caught by 'protect'

      // --- Authorization/Verification ---
      const course = await Course.findById(courseId);
      if (!course) {
          if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
          if (absolutePdfPath) await fsPromises.unlink(absolutePdfPath).catch(console.error);
          return res.status(404).json({ message: 'Course not found.' });
      }
      if (course.teacher?.toString() !== teacherId && req.user?.role !== 'admin') {
          if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
          if (absolutePdfPath) await fsPromises.unlink(absolutePdfPath).catch(console.error);
          return res.status(403).json({ message: 'Not authorized to upload to this course.' });
      }

       // --- Create Lesson Document ---
       const newLessonData = {
           title: title.trim(),
           objectives: objectives.trim(),
           keywords: keywords ? JSON.parse(keywords) : [], // Assuming keywords is a JSON string array from form
           course: courseId,
           teacher: teacherId,
           status: 'processing', // Start as processing if video needs it
       };

       if (videoFile) {
        newLessonData.videoUrl = `/uploads/videos/${videoFile.filename}`;
        newLessonData.videoOriginalName = videoFile.originalname;
       }
       if (pdfFile) {
           // Assuming your LessonModel has a field like 'resourceUrl' or 'pdfUrl'
           newLessonData.resources = `/uploads/pdf/${pdfFile.filename}`;
       }

       // If only PDF and no video, status can be 'ready' immediately
       if (pdfFile && !videoFile) {
          newLessonData.status = 'ready';
       }


       const newLesson = new Lesson(newLessonData);
       await newLesson.save();
       // LEEN: commented untill i add the socket io

const io = req.app.get('io');
if (io) {
  try {
    const enrollments = await Enrollment.find({ course: courseId }).populate('student', '_id username');
await Promise.all(enrollments.map(async (enroll) => {
  const studentId = enroll.student?._id?.toString();
  if (studentId) {
    io.to(studentId).emit('notification', {
      title: 'New Lesson Posted',
      message: `A new lesson "${newLesson.title}" has been uploaded to your course.`,
      type: 'lesson',
      courseId,
      lessonId: newLesson._id
    });
    await createNotification({
      userId: studentId,
      title: 'New Lesson Posted',
      message: `A new lesson "${newLesson.title}" has been uploaded to your course.`,
      link: `/student/courses/${courseId}/lessons/${newLesson._id}`, // رابط اختياري
      type: 'info'
    });
  }
}));
  } catch (notifErr) {
    console.error('Socket Notification Error:', notifErr.message);
  }
}
      // await logLessonActivity(actorId, actorUsername, 'LESSON_UPLOADED', 'Lesson', newLesson._id, newLesson.title);
      res.status(201).json({ message: 'Lesson upload received. Processing background tasks if any.', lesson: newLesson });

      // --- Trigger Background Processing ONLY IF there's a video file ---
      if (videoFile && absoluteVideoPath) {
          setImmediate(async () => {
              console.log(`Background processing started for Lesson ${newLesson._id} (video)...`);
              let audioPathForCleanup = '';
              try {
                //   const videoPathToProcess = newLesson.videoUrl; // From saved lesson
                const videoPathToProcess = absoluteVideoPath;
                const audioDir = path.resolve(__dirname, '..', 'uploads', 'audio');
                  await fsPromises.mkdir(audioDir, { recursive: true });
                  audioPathForCleanup = path.join(audioDir, `${newLesson._id}.mp3`);

                  await extractAudio(videoPathToProcess, audioPathForCleanup);
                  await Lesson.findByIdAndUpdate(newLesson._id, { audioPath: audioPathForCleanup });
                  console.log(`Audio extracted for Lesson ${newLesson._id}. Triggering transcription...`);

                  await transcribeLessonAudio(newLesson._id);

                  // Cleanup original uploaded video file if needed after successful transcription
                //   if (videoPathToProcess && videoPathToProcess !== newLesson.videoUrl) { // Ensure it's the temp path
                //       console.log(`[Processing Complete] Deleting temporary video file: ${videoPathToProcess}`);
                //       await fsPromises.unlink(videoPathToProcess).catch(e => console.error(`Error deleting processed video ${videoPathToProcess}:`, e));
                //   }
              } catch (processingError) {
                  // ... (error handling for background process) ...
                  console.error(`Error in background processing for lesson ${newLesson._id}:`, processingError);
                  try {
                     await Lesson.findByIdAndUpdate(newLesson._id, {
                         status: 'error',
                         errorMessage: `Background processing failed: ${processingError.message || 'Unknown error'}`.substring(0,500)
                     });
                  } catch (dbErr) { console.error("CRITICAL DB Error on background process fail:", dbErr); }
                  if (audioPathForCleanup) { await fsPromises.unlink(audioPathForCleanup).catch(e => {if (e.code !== 'ENOENT') console.error("Error deleting audio after background failure:", e);});}
              }
          });
      }
      // --- End Background Processing ---

  } catch (error) {
      console.error("Error in uploadLesson controller (before background):", error);
      if (absoluteVideoPath && !res.headersSent) { await fsPromises.unlink(absoluteVideoPath).catch(e => console.error("Error deleting video on controller error:", e)); }
      if (absolutePdfPath && !res.headersSent) { await fsPromises.unlink(absolutePdfPath).catch(e => console.error("Error deleting PDF on controller error:", e)); }

      if (!res.headersSent) {
          const statusCode = error.message.includes('authorized') || error.message.includes('found') ? 403 : (error.message.includes('Invalid') ? 400 : 500);
          res.status(statusCode).json({ message: error.message || 'Server error during lesson upload.' });
      }
  }
};*/
// Teama's upload function that also works -100%


const uploadLesson = async (req, res) => {
const videoFile = req.file;
  const absoluteVideoPath = videoFile?.path;
  console.log("🎥 Video path to process:", absoluteVideoPath);


  const teacherId = req.user?.id;

  try {
    const { title, objectives, keywords, courseId } = req.body;

    // ✅ التحقق من البيانات الأساسية
    if (!videoFile) {
      return res.status(400).json({ message: 'Video file is required.' });
    }
    if (!title || !objectives || !courseId) {
      if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
      return res.status(400).json({ message: 'Missing required fields: title, objectives, courseId.' });
    }
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
      return res.status(400).json({ message: 'Invalid Course ID format.' });
    }

    // ✅ تحقق من وجود الكورس وصلاحية المعلم
    const course = await Course.findById(courseId);
    if (!course) {
      if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
      return res.status(404).json({ message: 'Course not found.' });
    }
    if (course.teacher?.toString() !== teacherId && req.user?.role !== 'admin') {
      if (absoluteVideoPath) await fsPromises.unlink(absoluteVideoPath).catch(console.error);
      return res.status(403).json({ message: 'Not authorized to upload to this course.' });
    }

    // ✅ إنشاء بيانات الدرس
    const newLessonData = {
      title: title.trim(),
      objectives: objectives.trim(),
      keywords: keywords ? JSON.parse(keywords) : [],
      course: courseId,
      teacher: teacherId,
      status: 'processing',
      videoUrl: `/uploads/videos/${videoFile.filename}`,
      videoOriginalName: videoFile.originalname
    };

    const newLesson = new Lesson(newLessonData);
    await newLesson.save();

    // ✅ إرسال إشعارات Socket.IO للطلاب
    const io = req.app.get('io');
    if (io) {
      try {
        const enrollments = await Enrollment.find({ course: courseId }).populate('student', '_id username');
        await Promise.all(enrollments.map(async (enroll) => {
          const studentId = enroll.student?._id?.toString();
          if (studentId) {
            io.to(studentId).emit('notification', {
              title: 'New Lesson Posted',
              message: `A new lesson "${newLesson.title}" has been uploaded to your course.`,
              type: 'lesson',
              courseId,
              lessonId: newLesson._id
            });
            await createNotification({
              userId: studentId,
              title: 'New Lesson Posted',
              message: `A new lesson "${newLesson.title}" has been uploaded to your course.`,
              link: `/student/courses/${courseId}/lessons/${newLesson._id}`,
              type: 'info'
            });
          }
        }));
      } catch (notifErr) {
        console.error('Socket Notification Error:', notifErr.message);
      }
    }

    res.status(201).json({ message: 'Lesson uploaded. Processing in background...', lesson: newLesson });

    // ✅ معالجة الخلفية (توليد الصوت والترانسكريبت)
    if (videoFile && absoluteVideoPath) {
      setImmediate(async () => {
        console.log(`⏳ Background processing started for Lesson ${newLesson._id}...`);
        let audioPathForCleanup = '';
        try {
          const videoPathToProcess = absoluteVideoPath;
          const audioDir = path.resolve(__dirname, '..', 'uploads', 'audio');
          await fsPromises.mkdir(audioDir, { recursive: true });
          audioPathForCleanup = path.join(audioDir, `${newLesson._id}.mp3`);

          await extractAudio(videoPathToProcess, audioPathForCleanup);
          await Lesson.findByIdAndUpdate(newLesson._id, { audioPath: audioPathForCleanup });

          await transcribeLessonAudio(newLesson._id);
        } catch (processingError) {
          console.error(`❌ Background processing error for lesson ${newLesson._id}:`, processingError);
          try {
            await Lesson.findByIdAndUpdate(newLesson._id, {
              status: 'error',
              errorMessage: `Background processing failed: ${processingError.message}`.substring(0, 500)
            });
          } catch (dbErr) {
            console.error("⚠️ DB Error during processing failure update:", dbErr);
          }
          if (audioPathForCleanup) {
            await fsPromises.unlink(audioPathForCleanup).catch(e => {
              if (e.code !== 'ENOENT') console.error("🧹 Audio cleanup failed:", e);
            });
          }
        }
      });
    }

  } catch (error) {
    console.error("🔥 Error in uploadLesson controller:", error);
    if (absoluteVideoPath && !res.headersSent) {
      await fsPromises.unlink(absoluteVideoPath).catch(e => console.error("🗑 Video cleanup error:", e));
    }
    if (!res.headersSent) {
      const statusCode = error.message.includes('authorized') || error.message.includes('found') ? 403 :
        (error.message.includes('Invalid') ? 400 : 500);
      res.status(statusCode).json({ message: error.message || 'Server error during lesson upload.' });
    }
  }
};

const generateLessonFormat = async (req, res) => {
  if (!genAI) {
      return res.status(503).json({ message: 'AI Generation Service (Gemini) is not configured.' });
  }

  try {
      const { lessonId } = req.params;
      const { formatType: requestedFormatType} = req.body;
      const userId = req.user.id; // From 'protect' middleware
      const userRole = req.user.role;

      if (!requestedFormatType) { return res.status(400).json({ message: 'formatType is required.' }); }
      const formatType = requestedFormatType.toLowerCase();
      const allowedFormats = ['summary', 'flashcards', 'interactive_games', 'worksheets'];
      if (!allowedFormats.includes(formatType)) { return res.status(400).json({ message: 'Unsupported formatType.' }); }
      if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID format.' }); }

      const lesson = await Lesson.findById(lessonId).select('title objectives transcript status course teacher').lean();
      if (!lesson) { return res.status(404).json({ message: 'Lesson not found.' }); }

      // Authorization Check (Teacher, Admin, or Enrolled Student)
      const isTeacherOfLesson = lesson.teacher?.toString() === userId;
      const isAdmin = userRole === 'admin';
      let isEnrolled = false;
      if (userRole === 'student' && !isTeacherOfLesson && !isAdmin) {
          const enrollment = await Enrollment.findOne({ student: userId, course: lesson.course }).lean();
          isEnrolled = !!enrollment;
      }
      if (!isTeacherOfLesson && !isAdmin && !isEnrolled) {
          return res.status(403).json({ message: 'Forbidden: Not authorized to generate content for this lesson.' });
      }

      if (lesson.status !== 'ready' || !lesson.transcript) {
          return res.status(400).json({ message: `Lesson is not ready (Status: ${lesson.status}). Transcript might be missing.` });
      }

      // Cache Check
      const existingContent = await GeneratedContent.findOne({ lesson: lessonId, formatType: formatType }).lean();
      if (existingContent?.content) {
          return res.status(200).json({ format: formatType, content: existingContent.content, source: 'cache' });
      }

      let prompt = '';
      let parseJsonResponse = false;
      let maxOutputTokens = 800; let temperature = 0.7;
      switch (formatType.toLowerCase()) {
        case 'summary':
            prompt = `Provide a concise summary (max 10 bullet points) of the following lesson transcript, focusing on the objectives provided. Lesson Topic: "${lesson.title}". Learning Objectives: "${lesson.objectives}".\n\nTranscript:\n"""\n${lesson.transcript}\n"""`;
            maxOutputTokens = 300;
            temperature = 0.5; // Lower temperature for more focused summary
            break;
        case 'flashcards':
            // Added instructions to avoid markdown and ensure only JSON
            prompt = `Generate 5 to 10 key terms or concepts and their simple definitions based *only* on the provided transcript for the lesson titled "${lesson.title}". Ensure the definitions are concise and suitable for flashcards. Objectives for context: "${lesson.objectives}". Format the output ONLY as a valid JSON array of objects (no surrounding markdown like \`\`\`json). Each object must have exactly two keys: "term" (string) and "definition" (string). Example: [{"term": "Example", "definition": "An illustration."}]\n\nTranscript:\n"""\n${lesson.transcript}\n"""`;
            parseJsonResponse = true;
            maxOutputTokens = 800; // Generous allowance for JSON
            temperature = 0.6; // Slightly less creative for structured output
            break;
        case 'interactive_games': // Basic Quiz Example
            prompt = `Based on the lesson titled "${lesson.title}" and its transcript, create an interactive game in the form of a quiz. Provide exactly 5 multiple-choice questions with exactly 4 options each (labeled A, B, C, D) and clearly indicate the correct answer letter. Format the result ONLY as a valid JSON array of objects (no surrounding markdown like \`\`\`json). Each object must have keys: "question" (string), "options" (an array of 4 strings), and "answer" (string, the correct letter like "B").\n\nTranscript:\n"""\n${lesson.transcript}\n"""`;
            parseJsonResponse = true;
            maxOutputTokens = 1500; // Allow more tokens for quiz structure
            temperature = 0.7;
            break;
        case 'worksheets': // Basic Short Answer Example
            prompt = `Create a worksheet based on the lesson titled "${lesson.title}". Provide exactly 5 short-answer questions that encourage critical thinking about the content, along with a brief guideline or hint for answering each question. Format the output ONLY as a valid JSON array of objects (no surrounding markdown like \`\`\`json). Each object must have keys: "question" (string) and "guideline" (string).\n\nTranscript:\n"""\n${lesson.transcript}\n"""`;
            parseJsonResponse = true;
            maxOutputTokens = 1000;
            temperature = 0.7;
            break;
        default:
            return res.status(400).json({ message: 'Unsupported formatType.' });
    } 

            // --- Prepare SDK Call ---
            console.log(`[AI GEN - SDK] Generating ${formatType} for Lesson ${lessonId}...`);
            const model = genAI.getGenerativeModel({
                 model: "gemini-1.5-flash-latest",
                 safetySettings: [ // Define safety settings explicitly
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                  ],
                  generationConfig: {
                    temperature: temperature,
                    maxOutputTokens: maxOutputTokens,
                  },
             });
    
            // --- Call Gemini API using SDK ---
            const result = await model.generateContent(prompt);
            const response = result.response;
    
            // --- Process SDK Response ---
            // Check for issues *before* accessing text()
            if (!response || !response.candidates || response.candidates.length === 0) {
                const blockReason = response?.promptFeedback?.blockReason;
                if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
                    console.error(`[AI GEN - SDK] Content generation blocked: ${blockReason}`);
                    throw new Error(`Content generation blocked due to safety filters: ${blockReason}`);
                }
                console.error("[AI GEN - SDK] No candidates received from Gemini API:", response);
                throw new Error('Received no candidates from Gemini API.');
            }
    
            // Check finish reason of the first candidate
            const candidate = response.candidates[0];
            if (candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
                const safetyRatings = candidate.safetyRatings ?? [];
                console.error(`[AI GEN - SDK] Content generation stopped unexpectedly. Finish Reason: ${candidate.finishReason}`);
                console.error(`[AI GEN - SDK] Safety Ratings:`, JSON.stringify(safetyRatings));
                // Check specific safety ratings if needed
                const highSeverityRating = safetyRatings.find(r => r.probability === 'HIGH' || r.probability === 'MEDIUM');
                if (highSeverityRating) {
                     throw new Error(`Content generation stopped due to safety concerns (${highSeverityRating.category})`);
                } else {
                     throw new Error(`Content generation stopped unexpectedly: ${candidate.finishReason}`);
                }
            }
    
            // Get text only if generation stopped normally or due to max tokens
            const generatedText = response.text();
            console.log(`[AI GEN - SDK] Generation successful for ${formatType}, Lesson ${lessonId}.`);
    
            let finalContent = generatedText;
    
            // --- Parse JSON if expected ---
            if (parseJsonResponse) {
                try {
                    const cleanJsonString = generatedText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
                    finalContent = JSON.parse(cleanJsonString);
                    // Basic validation
                    if (formatType.toLowerCase() === 'flashcards' && (!Array.isArray(finalContent) || (finalContent.length > 0 && (finalContent[0].term === undefined || finalContent[0].definition === undefined)))) { throw new Error('Parsed JSON is not in the expected flashcard format.'); }
                    if (formatType.toLowerCase() === 'interactive_games' && (!Array.isArray(finalContent) || (finalContent.length > 0 && (finalContent[0].question === undefined || !Array.isArray(finalContent[0].options) || finalContent[0].options.length !== 4 || finalContent[0].answer === undefined)))) { throw new Error('Parsed JSON is not in the expected quiz game format.'); }
                    if (formatType.toLowerCase() === 'worksheets' && (!Array.isArray(finalContent) || (finalContent.length > 0 && (finalContent[0].question === undefined || finalContent[0].guideline === undefined)))) { throw new Error('Parsed JSON is not in the expected worksheet format.'); }
                } catch (parseError) {
                    console.error(`[AI GEN - SDK] Failed to parse JSON response from LLM for ${formatType}, Lesson ${lessonId}:`, parseError);
                    console.error("[AI GEN - SDK] Raw LLM Response:", generatedText);
                    return res.status(500).json({ message: `AI generated invalid JSON format for ${formatType}.`, rawOutput: generatedText });
                }
            }
    
             
            console.log(`[AI GEN CACHE] Saving generated ${formatType} for Lesson ${lessonId} to DB...`);
            try {
                // Use updateOne with upsert to handle potential race conditions
                await GeneratedContent.updateOne(
                    { lesson: lessonId, formatType: formatType }, // Find criteria
                    {
                        $set: { // Data to set/update
                            content: finalContent,
                            modelVersion: 'gemini-1.5-flash-latest', // Record the model used
                            // promptUsedHash: generateHash(prompt), // Optional: Store prompt hash for invalidation
                            // promptUsed: prompt // Optional: Store full prompt if needed for debug (can be large)
                        },
                        $setOnInsert: { // Fields to set only when creating a new document
                           lesson: lessonId,
                           formatType: formatType,
                           createdAt: new Date() // Explicitly set createdAt on insert with upsert
                        }
                    },
                    { upsert: true } // Create if document doesn't exist
                );
               console.log(`[AI GEN CACHE] Saved generated ${formatType} to DB.`);
            } catch (dbSaveError) {
                // Log the error but still return the content to the user as generation was successful
                console.error(`[AI GEN CACHE] WARNING: Failed to save generated content for Lesson ${lessonId} to DB:`, dbSaveError);
            }
            // *** END SAVE TO DB ***
            res.status(200).json({
                format: formatType,
                content: finalContent,
                source: 'generated' // Optional: Indicate it was newly generated
            });
           // res.status(200).json({ format: formatType, content: finalContent });
    
        } catch (error) {
            console.error(`[AI GEN - SDK] Error generating format ${req.body?.formatType} for lesson ${req.params?.lessonId}:`, error);
            res.status(500).json({ message: `Server error during AI content generation: ${error.message || 'Unknown AI error'}` });
        }
    };
    
/**
 * @desc    Translate existing AI-generated content for a lesson into a target language.
 * @route   POST /api/lessons/:lessonId/translate-content
 * @body    { formatType: string, originalContent: string | object, targetLanguage: string (e.g., "Spanish", "French", "Arabic") }
 * @access  Private (Authenticated user who can access the lesson)
 */
const translateGeneratedContent = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Translation Service (Gemini) is not configured.' });
    }

    try {
        const { lessonId } = req.params;
        const { formatType, originalContent, targetLanguage } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        // --- Input Validation ---
        if (!formatType || !originalContent || !targetLanguage) {
            return res.status(400).json({ message: 'Missing required fields: formatType, originalContent, or targetLanguage.' });
        }
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID format.' }); }

        // --- Authorization & Fetch Lesson (to ensure context and verify access) ---
        const lesson = await Lesson.findById(lessonId).select('title course teacher').lean();
        if (!lesson) { return res.status(404).json({ message: 'Lesson not found.' }); }

        const isTeacherOfLesson = lesson.teacher?.toString() === userId;
        const isAdmin = userRole === 'admin';
        let isEnrolled = false;
        if (userRole === 'student' && !isTeacherOfLesson && !isAdmin) {
            const enrollment = await Enrollment.findOne({ student: userId, course: lesson.course }).lean();
            isEnrolled = !!enrollment;
        }
        if (!isTeacherOfLesson && !isAdmin && !isEnrolled) {
            return res.status(403).json({ message: 'Forbidden: Not authorized to access this lesson\'s content.' });
        }

        // --- Construct Prompt for Translation ---
        let contentToTranslateString;
        let instructionForFormat = ""; // To help AI maintain structure for JSON types

        if (typeof originalContent === 'string') {
            contentToTranslateString = originalContent;
        } else if (typeof originalContent === 'object') {
            // For structured content like flashcards or quizzes, stringify it and tell AI to maintain format
            contentToTranslateString = JSON.stringify(originalContent, null, 2); // Pretty print for AI context
            if (formatType === 'flashcards') {
                instructionForFormat = `The input is a JSON array of flashcards, each with "term" and "definition". Translate the text within both "term" and "definition" for each object. Return the result as a valid JSON array with the same structure.`;
            } else if (formatType === 'interactive_games') { // Quiz
                instructionForFormat = `The input is a JSON array of quiz questions, each with "question", "options" (array of strings), and "answer". Translate the text for "question" and each string in "options". The "answer" (which is likely a letter like "A", "B") should NOT be translated. Return the result as a valid JSON array with the same structure.`;
            } else if (formatType === 'worksheets') {
                instructionForFormat = `The input is a JSON array of worksheet questions, each with "question" and "guideline". Translate the text for "question" and "guideline". Return the result as a valid JSON array with the same structure.`;
            } else {
                // For unknown complex types, might just translate as best as possible
                instructionForFormat = `The input is a JSON object or array. Translate all textual content within it. Try to maintain the original JSON structure in your output.`;
            }
        } else {
            return res.status(400).json({ message: 'originalContent must be a string or a JSON object/array.' });
        }

        const translationPrompt = `
            You are an expert translator. Translate the following content, which is part of a lesson titled "${lesson.title}", into ${targetLanguage}.
            ${instructionForFormat}

            Content to Translate (originally in English):
            """
            ${contentToTranslateString}
            """

            Provide ONLY the translated content in ${targetLanguage}. If the original content was JSON, ensure your output is also valid JSON with the same structure.
        `;

        console.log(`[AI TRANSLATE] Translating ${formatType} for Lesson ${lessonId} to ${targetLanguage}...`);

        // --- Call Gemini API ---
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            safetySettings: [ // Define safety settings explicitly
               { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
             ],
       
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }, // Lower temp for translation, allow more tokens
        });
        const result = await model.generateContent(translationPrompt);
        const response = result.response;

        // --- Process SDK Response (similar to generateLessonFormat) ---
        if (!response || !response.candidates || response.candidates.length === 0 || !response.text) { /* ... handle no valid response ... */
            const blockReason = response?.promptFeedback?.blockReason;
            const finishReason = response?.candidates?.[0]?.finishReason;
            console.error(`[AI TRANSLATE] No valid response. Block: ${blockReason}, Finish: ${finishReason}`);
            throw new Error(`AI translation failed. BlockReason: ${blockReason}, FinishReason: ${finishReason}`);
        }

        const translatedText = response.text();
        console.log(`[AI TRANSLATE] Translation successful for ${formatType}, Lesson ${lessonId} to ${targetLanguage}.`);

        let finalTranslatedContent = translatedText;

        // --- Parse JSON if original was JSON ---
        if (typeof originalContent === 'object') { // If original was an object, try to parse translation as JSON
            try {
                const cleanJsonString = translatedText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
                finalTranslatedContent = JSON.parse(cleanJsonString);
                // Optional: Add validation for specific formats if needed
            } catch (parseError) {
                console.error(`[AI TRANSLATE] Failed to parse translated JSON for ${formatType}:`, parseError);
                console.error("[AI TRANSLATE] Raw Translated Text:", translatedText);
                // Return raw text if JSON parsing fails, frontend might handle it or show error
                finalTranslatedContent = translatedText; // Fallback to raw text
            }
        }

        res.status(200).json({
            format: formatType,
            translatedContent: finalTranslatedContent,
            targetLanguage: targetLanguage
        });

    } catch (error) {
        console.error(`[AI TRANSLATE] Error translating content for lesson ${req.params.lessonId}:`, error);
        res.status(500).json({ message: `Server error during content translation: ${error.message || 'Unknown AI error'}` });
    }
};
const deleteLesson = async (req, res) => {
    try {
      const lesson = await Lesson.findById(req.params.id);
      if (!lesson) {
        return res.status(404).json({ message: 'Lesson not found' });
      }
  
      // Optional: check if req.user._id === lesson.teacher.toString()
      await Lesson.findByIdAndDelete(req.params.id);
      res.status(200).json({ message: 'Lesson deleted successfully' });
    } catch (err) {
      console.error('Delete Lesson Error:', err);
      res.status(500).json({ message: 'Server error deleting lesson' });
    }
  };
 
  const updateLesson = async (req, res) => {
    try {
      const { title, objectives, keywords } = req.body;
      const lessonId = req.params.id;
  
      const lesson = await Lesson.findById(lessonId);
      if (!lesson) {
        return res.status(404).json({ message: 'Lesson not found' });
      }
  
      if (lesson.teacher.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized to update this lesson' });
      }
  
      lesson.title = title || lesson.title;
      lesson.objectives = objectives || lesson.objectives;
      lesson.keywords = keywords || lesson.keywords; // ✅ هذا هو السطر المهم
  
      await lesson.save();
      res.status(200).json({ message: 'Lesson updated successfully', lesson });
    } catch (err) {
      console.error('Update Lesson Error:', err);
      res.status(500).json({ message: 'Server error updating lesson', error: err.message });
    }
  };
  ///////////////////////////
  const getLessonDetails = async (req, res) => {
      try {
          const { lessonId } = req.params;
          const userId = req.user.id;
          const userRole = req.user.role;
  
          if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID' }); }
  
          // Fetch lesson including course and teacher for auth check
          const lesson = await Lesson.findById(lessonId).select('+transcript').populate('course', 'teacher students').lean(); // Select transcript, populate course
  
          if (!lesson) { return res.status(404).json({ message: 'Lesson not found' }); }
  
          // *** AUTHORIZATION CHECK ***
          const isTeacherOfLesson = lesson.teacher?.toString() === userId;
          const isAdmin = userRole === 'admin';
          // Check enrollment using the populated course.students array
          const isEnrolled = lesson.course?.students?.map(id => id.toString()).includes(userId) ?? false;
  
          if (!isTeacherOfLesson && !isAdmin && !isEnrolled) {
              return res.status(403).json({ message: 'Forbidden: You cannot access this lesson.' });
          }
          // *** END AUTHORIZATION CHECK ***
  
  
          // Exclude sensitive or internal fields before sending
          const { audioPath, course, ...lessonDetails } = lesson; // Exclude audioPath and the nested course used for auth
          res.status(200).json(lessonDetails);
  
      } catch (error) {
          console.error(`Error fetching lesson details for ${req.params.lessonId}:`, error);
          res.status(500).json({ message: 'Failed to fetch lesson details' });
      }
  };
  // Get Lessons for a Course (GET /api/lessons/course/:courseId)
  const getLessonsByCourse = async (req, res) => {
      try {
          const { courseId } = req.params;
          const userId = req.user.id;
          const userRole = req.user.role;
  
           if (!mongoose.Types.ObjectId.isValid(courseId)) { return res.status(400).json({ message: 'Invalid Course ID' }); }
  
           // *** AUTHORIZATION CHECK ***
           // Fetch the course first to check teacher/enrollment
           const course = await Course.findById(courseId).select('teacher students').lean();
           if (!course) { return res.status(404).json({ message: 'Course not found' }); }
  
           const isTeacherOfCourse = course.teacher?.toString() === userId;
           const isAdmin = userRole === 'admin';
           const isEnrolled = course.students?.map(id => id.toString()).includes(userId) ?? false;
  
           if (!isTeacherOfCourse && !isAdmin && !isEnrolled) {
               return res.status(403).json({ message: 'Forbidden: You cannot access lessons for this course.' });
           }
           // *** END AUTHORIZATION CHECK ***
  
  
           // If authorized, fetch the lessons for that course
           const lessons = await Lesson.find({ course: courseId })
               .select('title objectives status createdAt') // Select fields needed for list view
               .sort({ createdAt: 1 })
               .lean();
  
           res.status(200).json(lessons);
  
       } catch (error) {
           console.error(`Error fetching lessons for course ${req.params.courseId}:`, error);
           res.status(500).json({ message: 'Failed to fetch lessons' });
       }
  };
  
  // --- Exports ---
  module.exports = {
      uploadLesson,
      generateLessonFormat,
      translateGeneratedContent,
      getLessonDetails,
      getLessonsByCourse,
      updateLesson, 
      deleteLesson
  };
  
