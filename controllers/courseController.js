// backend/controllers/courseController.js
const Course = require('../models/courseModel');
const Lesson = require('../models/LessonModel'); // If needed for context for AI
const User = require('../models/UserModel');     // For teacher/student context if needed
const Enrollment = require('../models/EnrollmentModel'); // To exclude enrolled courses
const mongoose = require('mongoose');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");


// Get Public Course Details (for Pre-Enrollment View)
exports.getPublicCourseDetails = async (req, res) => {
    try {
        const { courseId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID format.' });
         }

        // Fetch the course, ensuring it's approved
        const course = await Course.findOne({ _id: courseId, status: 'approved' })
            .select('name description teacher subject price syllabus') // Select public fields
            .populate('teacher', 'username') // Populate teacher's name
            .populate('subject', 'name')     // Populate subject's name
            .lean();

        if (!course) {
            return res.status(404).json({ message: 'Approved course not found.' });
        }

        // Fetch counts for display (Chapters/Lessons, Classes/?, Duration/?)
        // Count lessons associated with this course
        const lessonCount = await Lesson.countDocuments({ course: courseId });

        // Placeholder for Duration - you might need to add a 'durationEstimate' field
        // to your CourseModel or calculate it based on lesson video lengths (complex).
        const durationPlaceholder = `${Math.round((lessonCount * 0.75))}hrs`; // Rough estimate

        // Respond with combined data
        res.status(200).json({
            _id: course._id,
            name: course.name,
            description: course.description,
            teacherName: course.teacher?.username ?? 'N/A', // Handle null teacher just in case
            subjectName: course.subject?.name ?? 'N/A', // Handle null subject
            subjectId: course.subject?._id?.toString(), // The actual ID from the Course document
            price: course.price,
            teacherId: course.teacher?._id,
            // Use lesson count for "Chapters" or "Classes" - decide on terminology
            lessonCount: lessonCount,
            durationEstimate: durationPlaceholder, // Send estimate
            // Optionally send a snippet of the syllabus if desired for preview
             syllabusSnippet: course.syllabus ? course.syllabus.substring(0, 100) + '...' : null
        });

    } catch (error) {
        console.error(`Error fetching public course details for ${req.params.courseId}:`, error);
        res.status(500).json({ message: 'Failed to fetch course details.' });
    }
};

// Add other public course-related functions here later (e.g., search public courses)
let genAI;
if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log("[AI Init] Google Generative AI client initialized for course search.");
    } catch (e) { console.error("[AI Init] CRITICAL: Failed to initialize Gemini client:", e); genAI = null; }
} else { console.warn("[AI Init] WARNING: GEMINI_API_KEY missing for course search."); genAI = null; }
// --- End AI Client Initialization ---


/**
 * @desc    Perform an AI-enhanced search for courses.
 * @route   POST /api/courses/ai-search  (Using POST to send a potentially larger list of course candidates if pre-filtering)
 *          OR GET /api/courses/ai-search?q=your_query (Simpler for initial implementation)
 * @body    { searchQuery: "user's text", prefilteredCourseIds: [id1, id2] (optional) }
 * @access  Private (Authenticated Users)
 */

/**
 * @desc    Perform an AI-enhanced search for courses.
 * @route   POST /api/courses/ai-search  (Using POST to send a potentially larger list of course candidates if pre-filtering)
 *          OR GET /api/courses/ai-search?q=your_query (Simpler for initial implementation)
 * @body    { searchQuery: "user's text", prefilteredCourseIds: [id1, id2] (optional) }
 * @access  Private (Authenticated Users)
 */
exports.aiEnhancedCourseSearch = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Search Service is not configured.' });
    }

    const { searchQuery } = req.body; // Or req.query.q for GET
    const studentId = req.user.id; // For excluding enrolled courses

    if (!searchQuery || searchQuery.trim().length < 3) {
        return res.status(400).json({ message: 'Search query must be at least 3 characters long.' });
    }

    console.log(`[AI Search] Received query: "${searchQuery}" for user ${studentId}`);

    try {
        // --- Step 1: Fetch Candidate Courses ---
        // Fetch approved courses. For a start, let's fetch a reasonable number.
        // In a larger system, you might pre-filter based on keywords from searchQuery
        // or use vector embeddings for a first-pass candidate selection.

        // Find courses student is already enrolled in to exclude them from search results
        const existingEnrollments = await Enrollment.find({ student: studentId }).select('course -_id').lean();
        const enrolledCourseIds = existingEnrollments.map(e => e.course);

        // Fetch a batch of approved, non-enrolled courses.
        // Limit initial fetch to avoid sending too much data to LLM.
        const candidateCourses = await Course.find({
            status: 'approved',
            _id: { $nin: enrolledCourseIds } // Exclude already enrolled courses
        })
        .select('name description objectives subject keywords teacher price') // Fields important for AI understanding
        .populate('subject', 'name')
        .populate('teacher', 'username')
        .limit(50) // Example limit: send up to 50 courses to the AI for ranking
        .lean();

        if (candidateCourses.length === 0) {
            console.log("[AI Search] No candidate courses found after initial filtering.");
            return res.status(200).json([]); // Return empty if no candidates
        }

        // --- Step 2: Prepare Data for LLM ---
        const coursesForLLM = candidateCourses.map(course => ({
            id: course._id.toString(),
            name: course.name,
            description: course.description || '',
            objectives: course.objectives || '', // Assuming objectives is a string
            subject: course.subject?.name || '',
            keywords: Array.isArray(course.keywords) ? course.keywords.join(', ') : '',
            price: course.price
            // teacher: course.teacher?.username || '' // Optional to include teacher
        }));

        
        const prompt = `
            A student is searching for courses with the query: "${searchQuery}"

            Below is a list of available courses. For each course, assess its relevance to the student's search query.
            Consider the course name, description, objectives, subject, and keywords.
            Provide a relevance score from 1 (Not Relevant) to 5 (Highly Relevant).
            Also, provide a brief (1-2 sentence) explanation for your relevance score.

            Format your response ONLY as a valid JSON array of objects. Each object must have the following exact keys:
            - "courseId": string (the ID of the course from the list below)
            - "relevanceScore": number (integer from 1 to 5)
            - "explanation": string (your brief explanation of relevance)

            Example output:
            [
              {"courseId": "course_id_1", "relevanceScore": 5, "explanation": "This course directly teaches the core concepts mentioned in the query."},
              {"courseId": "course_id_2", "relevanceScore": 2, "explanation": "This course is tangentially related but not a primary match."}
            ]

            Courses to evaluate:
            ${JSON.stringify(coursesForLLM, null, 2)}
        `;

        console.log("[AI Search] Prompt being sent to LLM:", prompt); // For debugging

        // --- Step 4: Send Prompt to LLM (Gemini) ---
        console.log(`[AI Search] Sending ${coursesForLLM.length} courses to Gemini for query: "${searchQuery}"`);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest", // Or "gemini-1.5-flash-latest"
            safetySettings: [ // Define safety settings explicitly
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
              ],
            generationConfig: { temperature: 0.2, maxOutputTokens: 6000 }, // Lower temp for more factual ranking
        });
  
        const result = await model.generateContent(prompt);
        const response = result.response;

        // --- Step 5: Process LLM Response ---
        if (!response || !response.candidates || response.candidates.length === 0 || !response.text) {
            // Handle blocked or empty AI responses
            console.error("[AI Search] Invalid or empty response from Gemini.");
            throw new Error('AI service did not provide a valid response for search ranking.');
        }

        const aiResponseText = response.text();
         console.log("[AI Search] Raw AI Response Text:", aiResponseText); // For debugging
 
        let rankedResults;
        try {
            const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
            rankedResults = JSON.parse(cleanJsonString);
            if (!Array.isArray(rankedResults)) throw new Error("AI response is not a JSON array.");
        } catch (parseError) {
            console.error("[AI Search] Failed to parse JSON from AI:", parseError, "\nRaw AI text:", aiResponseText);
            throw new Error('AI returned an invalid format for search results.');
        }

        // --- Step 6: Filter & Sort based on AI Ranking ---
        const relevantCoursesMap = new Map();
        for (const aiResult of rankedResults) {
            if (aiResult.courseId && typeof aiResult.relevanceScore === 'number' && aiResult.relevanceScore >= 3) { // Threshold of 3
                const originalCourse = candidateCourses.find(c => c._id.toString() === aiResult.courseId);
                if (originalCourse) {
                    relevantCoursesMap.set(aiResult.courseId, {
                        ...originalCourse, // Spread original course details
                        aiRelevanceScore: aiResult.relevanceScore,
                        aiExplanation: aiResult.explanation || ''
                    });
                }
            }
        }

        const finalResults = Array.from(relevantCoursesMap.values())
                                .sort((a, b) => b.aiRelevanceScore - a.aiRelevanceScore); // Sort by score descending

        console.log(`[AI Search] Found ${finalResults.length} relevant courses after AI ranking.`);
        res.status(200).json(finalResults);

    } catch (error) {
        console.error("[AI Search] Error:", error);
        res.status(500).json({ message: `AI-enhanced search failed: ${error.message}` });
    }
};



// exports.aiEnhancedCourseSearch = async (req, res) => {
//     if (!genAI) {
//         return res.status(503).json({ message: 'AI Search Service is not configured.' });
//     }

//     const { searchQuery } = req.body; // Or req.query.q for GET
//     const studentId = req.user.id; // For excluding enrolled courses

//     if (!searchQuery || searchQuery.trim().length < 3) {
//         return res.status(400).json({ message: 'Search query must be at least 3 characters long.' });
//     }

//     console.log(`[AI Search] Received query: "${searchQuery}" for user ${studentId}`);

//     try {
//         // --- Step 1: Fetch Candidate Courses ---
//         // Fetch approved courses. For a start, let's fetch a reasonable number.
//         // In a larger system, you might pre-filter based on keywords from searchQuery
//         // or use vector embeddings for a first-pass candidate selection.

//         // Find courses student is already enrolled in to exclude them from search results
//         const existingEnrollments = await Enrollment.find({ student: studentId }).select('course -_id').lean();
//         const enrolledCourseIds = existingEnrollments.map(e => e.course);

//         // Fetch a batch of approved, non-enrolled courses.
//         // Limit initial fetch to avoid sending too much data to LLM.
//         const candidateCourses = await Course.find({
//             status: 'approved',
//             _id: { $nin: enrolledCourseIds } // Exclude already enrolled courses
//         })
//         .select('name description objectives subject keywords teacher price') // Fields important for AI understanding
//         .populate('subject', 'name')
//         .populate('teacher', 'username')
//         .limit(50) // Example limit: send up to 50 courses to the AI for ranking
//         .lean();

//         if (candidateCourses.length === 0) {
//             console.log("[AI Search] No candidate courses found after initial filtering.");
//             return res.status(200).json([]); // Return empty if no candidates
//         }

//         // --- Step 2: Prepare Data for LLM ---
//         const coursesForLLM = candidateCourses.map(course => ({
//             id: course._id.toString(),
//             name: course.name,
//             description: course.description || '',
//             objectives: course.objectives || '', // Assuming objectives is a string
//             subject: course.subject?.name || '',
//             keywords: Array.isArray(course.keywords) ? course.keywords.join(', ') : '',
//             price: course.price
//             // teacher: course.teacher?.username || '' // Optional to include teacher
//         }));

        
//         const prompt = `
//             A student is searching for courses with the query: "${searchQuery}"

//             Below is a list of available courses. For each course, assess its relevance to the student's search query.
//             Consider the course name, description, objectives, subject, and keywords.
//             Provide a relevance score from 1 (Not Relevant) to 5 (Highly Relevant).
//             Also, provide a brief (1-2 sentence) explanation for your relevance score.

//             Format your response ONLY as a valid JSON array of objects. Each object must have the following exact keys:
//             - "courseId": string (the ID of the course from the list below)
//             - "relevanceScore": number (integer from 1 to 5)
//             - "explanation": string (your brief explanation of relevance)

//             Example output:
//             [
//               {"courseId": "course_id_1", "relevanceScore": 5, "explanation": "This course directly teaches the core concepts mentioned in the query."},
//               {"courseId": "course_id_2", "relevanceScore": 2, "explanation": "This course is tangentially related but not a primary match."}
//             ]

//             Courses to evaluate:
//             ${JSON.stringify(coursesForLLM, null, 2)}
//         `;

//         console.log("[AI Search] Prompt being sent to LLM:", prompt); // For debugging

//         // --- Step 4: Send Prompt to LLM (Gemini) ---
//         console.log(`[AI Search] Sending ${coursesForLLM.length} courses to Gemini for query: "${searchQuery}"`);
//         const model = genAI.getGenerativeModel({
//             model: "gemini-1.5-flash-latest", // Or "gemini-1.5-flash-latest"
//             safetySettings: [ // Define safety settings explicitly
//                 { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
//                 { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
//                 { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
//                 { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
//               ],
//             generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }, // Lower temp for more factual ranking
//         });

//         const result = await model.generateContent(prompt);
//         const response = result.response;

//         // --- Step 5: Process LLM Response ---
//         if (!response || !response.candidates || response.candidates.length === 0 || !response.text) {
//             // Handle blocked or empty AI responses
//             console.error("[AI Search] Invalid or empty response from Gemini.");
//             throw new Error('AI service did not provide a valid response for search ranking.');
//         }

//         const aiResponseText = response.text();
//          console.log("[AI Search] Raw AI Response Text:", aiResponseText); // For debugging

//         let rankedResults;
//         try {
//             const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
//             rankedResults = JSON.parse(cleanJsonString);
//             if (!Array.isArray(rankedResults)) throw new Error("AI response is not a JSON array.");
//         } catch (parseError) {
//             console.error("[AI Search] Failed to parse JSON from AI:", parseError, "\nRaw AI text:", aiResponseText);
//             throw new Error('AI returned an invalid format for search results.');
//         }

//         // --- Step 6: Filter & Sort based on AI Ranking ---
//         const relevantCoursesMap = new Map();
//         for (const aiResult of rankedResults) {
//             if (aiResult.courseId && typeof aiResult.relevanceScore === 'number' && aiResult.relevanceScore >= 3) { // Threshold of 3
//                 const originalCourse = candidateCourses.find(c => c._id.toString() === aiResult.courseId);
//                 if (originalCourse) {
//                     relevantCoursesMap.set(aiResult.courseId, {
//                         ...originalCourse, // Spread original course details
//                         aiRelevanceScore: aiResult.relevanceScore,
//                         aiExplanation: aiResult.explanation || ''
//                     });
//                 }
//             }
//         }

//         const finalResults = Array.from(relevantCoursesMap.values())
//                                 .sort((a, b) => b.aiRelevanceScore - a.aiRelevanceScore); // Sort by score descending

//         console.log(`[AI Search] Found ${finalResults.length} relevant courses after AI ranking.`);
//         res.status(200).json(finalResults);

//     } catch (error) {
//         console.error("[AI Search] Error:", error);
//         res.status(500).json({ message: `AI-enhanced search failed: ${error.message}` });
//     }
// };