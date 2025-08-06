// backend/controllers/recommendationController.js
const mongoose = require('mongoose');
const Course = require('../models/courseModel');
const Enrollment = require('../models/EnrollmentModel');
const Subject = require('../models/SubjectModel'); // For fetching subject names
const User = require('../models/UserModel');     // For fetching student details if needed
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// Initialize Gemini AI Client (ensure GEMINI_API_KEY is in .env)
let genAI;
if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log("[AI Recommendation] Gemini client initialized.");
    } catch (e) { console.error("[AI Recommendation] Failed to initialize Gemini client:", e); genAI = null; }
} else { console.warn("[AI Recommendation] GEMINI_API_KEY not set."); genAI = null; }


// --- 1. Get Popular Courses (by Enrollment Count) ---
exports.getPopularCourses = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5; // Default to 5 popular courses

        // Aggregate to count enrollments per course
        const popularCoursesData = await Enrollment.aggregate([
            { $group: { _id: '$course', enrollmentCount: { $sum: 1 } } }, // Group by courseId and count
            { $sort: { enrollmentCount: -1 } }, // Sort by most enrollments
            { $limit: limit },
            { // Lookup course details
                $lookup: {
                    from: 'courses', // The actual name of your courses collection in MongoDB
                    localField: '_id',
                    foreignField: '_id',
                    as: 'courseDetails'
                }
            },
            { $unwind: '$courseDetails' }, // Deconstruct the courseDetails array
            { // Further lookup for subject and teacher for the matched course
                $lookup: {
                    from: 'subjects',
                    localField: 'courseDetails.subject',
                    foreignField: '_id',
                    as: 'courseDetails.subjectFull'
                }
            },
            {
                $lookup: {
                    from: 'users', // The actual name of your users collection
                    localField: 'courseDetails.teacher',
                    foreignField: '_id',
                    as: 'courseDetails.teacherFull'
                }
            },
            {
                $project: { // Shape the final output
                    _id: '$courseDetails._id',
                    name: '$courseDetails.name',
                    description: '$courseDetails.description',
                    price: '$courseDetails.price',
                    status: '$courseDetails.status',
                    subject: { $arrayElemAt: ['$courseDetails.subjectFull', 0] }, // Get first element or null
                    teacher: { $arrayElemAt: ['$courseDetails.teacherFull', 0] },
                    enrollmentCount: '$enrollmentCount',
                    // Add other fields you want from courseDetails
                    createdAt: '$courseDetails.createdAt' // For potential tie-breaking or display
                }
            }
        ]);

        // Filter out courses where subject or teacher might not have been found after lookup (if fields were deleted)
        const validPopularCourses = popularCoursesData.filter(c => c.status === 'approved');

        // Clean up teacher object to only send username
        const coursesWithTeacherName = validPopularCourses.map(course => ({
            ...course,
            teacherName: course.teacher?.username || 'N/A',
            teacherId: course.teacher?._id || null,
            teacher: undefined // Remove the full teacher object if only name/ID is needed
        }));


        res.status(200).json(coursesWithTeacherName);
    } catch (error) {
        console.error("Error fetching popular courses:", error);
        res.status(500).json({ message: "Failed to fetch popular courses" });
    }
};

// --- 2. Get Newest Courses ---
exports.getNewestCourses = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const courses = await Course.find({ status: 'approved' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('teacher', 'username') // Only select username
            .populate('subject', 'name')     // Only select subject name
            .select('name description price subject teacher createdAt status') // Select specific fields
            .lean();

        const formattedCourses = courses.map(course => ({
            ...course,
            teacherName: course.teacher?.username || 'N/A',
            teacherId: course.teacher?._id || null,
        }));


        res.status(200).json(formattedCourses);
    } catch (error) {
        console.error("Error fetching newest courses:", error);
        res.status(500).json({ message: "Failed to fetch newest courses" });
    }
};


// --- 3. Personalized "For You" Recommendations (Content-Based + AI for cross-subject) ---
exports.getPersonalizedRecommendations = async (req, res) => {
    try {
        const studentId = req.user.id;
        const limit = parseInt(req.query.limit) || 5; // Number of recommendations to return
        const aiRecommendationCount = 3; // How many recommendations to ask the AI for specifically

        console.log(`[Reco For You] Student: ${studentId}, Limit: ${limit}`);

        // --- Step A: Get student's enrolled courses and their details ---
        const enrollments = await Enrollment.find({ student: studentId })
            .populate({
                path: 'course',
                select: 'name description subject status keywords', // Include keywords
                match: { status: 'approved' },
                populate: { path: 'subject', select: 'name' }
            })
            .lean();

        const enrolledCourses = enrollments.map(e => e.course).filter(c => c); // Filter out null courses
        const enrolledCourseIds = enrolledCourses.map(c => c._id.toString());
        const enrolledCourseSummaries = enrolledCourses.map(
            c => `- "${c.name}" (Subject: ${c.subject?.name || 'N/A'}). Description: ${c.description?.substring(0, 100) || 'N/A'}...`
        ).join("\n");

        let finalRecommendations = [];

        // --- Step B: Simple Content-Based: More courses in enrolled subjects ---
        if (enrolledCourses.length > 0) {
            const enrolledSubjectIds = [...new Set(enrolledCourses.map(c => c.subject?._id?.toString()).filter(id => id))];
            if (enrolledSubjectIds.length > 0) {
                const coursesInEnrolledSubjects = await Course.find({
                    status: 'approved',
                    subject: { $in: enrolledSubjectIds },
                    _id: { $nin: enrolledCourseIds }
                })
                .sort({ enrollmentCount: -1, ratingAverage: -1 })
                .limit(limit) // Fetch a good number initially
                .populate('teacher', 'username')
                .populate('subject', 'name')
                .select('name description price subject teacher createdAt status _id') // Ensure _id is selected
                .lean();
                finalRecommendations.push(...coursesInEnrolledSubjects);
            }
        }

        // --- Step C: AI-Powered Cross-Subject/Deeper Recommendations ---
        if (genAI && enrolledCourseSummaries.length > 0 && finalRecommendations.length < limit) {
            console.log("[AI Reco] Trying AI for more recommendations.");

            // 1. Fetch a catalog of *other* available courses for the AI to choose from
            const potentialCandidateCourses = await Course.find({
                status: 'approved',
                _id: { $nin: [...enrolledCourseIds, ...finalRecommendations.map(c => c._id.toString())] } // Exclude already enrolled AND already found by simple content-based
            })
            .select('name description subject keywords _id') // Send minimal but relevant info
            .populate('subject', 'name')
            .limit(50) // Limit catalog size sent to AI to manage token count
            .lean();

            if (potentialCandidateCourses.length > 0) {
                const catalogString = potentialCandidateCourses.map(
                    c => `ID: ${c._id}, Name: "${c.name}", Subject: ${c.subject?.name || 'N/A'}, Keywords: ${(c.keywords || []).join(', ')}, Description: ${c.description?.substring(0, 150) || 'N/A'}...`
                ).join("\n");

                const aiPrompt = `
                    A student has the following profile based on their current enrollments:
                    ${enrolledCourseSummaries}

                    Here is a catalog of other available courses:
                    ${catalogString}

                    Based on the student's current enrollments, please recommend up to ${aiRecommendationCount} courses from the provided catalog that would be a good fit for them, either to deepen their knowledge in related areas or to explore complementary skills.
                    Prioritize courses that seem most relevant to their existing interests but are different from what they are already taking.

                    Return your response ONLY as a valid JSON array of objects. Each object should have an "id" key (the course ID from the catalog) and a "reason" key (a brief 1-sentence explanation for why this course is recommended for this student).
                    Example:
                    [
                        {"id": "67fc0a8f2a2af2c078052050", "reason": "This advanced topic complements their foundational knowledge in a similar subject."},
                        {"id": "anotherCourseId123", "reason": "Offers a skill in a different area that often pairs well with their current studies."}
                    ]
                    If you cannot find suitable recommendations from the catalog, return an empty array [].
                `;

                console.log("[AI Reco] Sending prompt to Gemini...");
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", generationConfig: { temperature: 0.6, maxOutputTokens: 500 } });
                    const result = await model.generateContent(aiPrompt);
                    const response = result.response;

                    if (response && response.candidates && response.candidates.length > 0 && response.text()) {
                        const aiResponseText = response.text();
                        console.log("[AI Reco] Raw AI Response:", aiResponseText);
                        const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
                        let aiSuggestedItems = [];
                        try {
                           aiSuggestedItems = JSON.parse(cleanJsonString);
                        } catch (e) { console.error("[AI Reco] Failed to parse AI JSON response:", e, "Raw:", cleanJsonString); }


                        if (Array.isArray(aiSuggestedItems) && aiSuggestedItems.length > 0) {
                            const aiRecommendedCourseIds = aiSuggestedItems
                                .map(item => item.id?.toString()) // Ensure ID is string
                                .filter(id => id && mongoose.Types.ObjectId.isValid(id)); // Filter valid ObjectIds

                            if (aiRecommendedCourseIds.length > 0) {
                                const aiCoursesDetails = await Course.find({
                                    _id: { $in: aiRecommendedCourseIds },
                                    status: 'approved' // Double check status
                                })
                                .populate('teacher', 'username')
                                .populate('subject', 'name')
                                .select('name description price subject teacher createdAt status _id')
                                .lean();

                                // Add these to recommendations, avoiding duplicates
                                for (const aiCourse of aiCoursesDetails) {
                                    if (!finalRecommendations.find(rec => rec._id.toString() === aiCourse._id.toString())) {
                                        finalRecommendations.push(aiCourse);
                                    }
                                }
                                console.log(`[AI Reco] Added ${aiCoursesDetails.length} courses from AI suggestion.`);
                            }
                        }
                    } else {
                         console.log("[AI Reco] AI provided no usable candidates or text response.");
                         const blockReason = response?.promptFeedback?.blockReason;
                         const finishReason = response?.candidates?.[0]?.finishReason;
                         console.error(`[AI Reco] Block: ${blockReason}, Finish: ${finishReason}`);
                    }
                } catch (aiError) {
                    console.error("[AI Reco] Error calling Gemini for recommendations:", aiError.message);
                }
            } else {
                console.log("[AI Reco] No candidate courses available to send to AI after initial filtering.");
            }
        }


        // --- Step D: Fallback - Top up with general popular courses if still not enough ---
        if (finalRecommendations.length < limit) {
            const existingIdsToExclude = [...enrolledCourseIds, ...finalRecommendations.map(c => c._id.toString())];
            console.log(`[Reco Fallback] Need ${limit - finalRecommendations.length} more courses. Excluding ${existingIdsToExclude.length} IDs.`);

            const popularFallback = await Course.find({
                status: 'approved',
                _id: { $nin: existingIdsToExclude }
            })
            .sort({ enrollmentCount: -1, ratingAverage: -1 })
            .limit(limit - finalRecommendations.length)
            .populate('teacher', 'username')
            .populate('subject', 'name')
            .select('name description price subject teacher createdAt status _id')
            .lean();
            finalRecommendations.push(...popularFallback);
            console.log(`[Reco Fallback] Added ${popularFallback.length} popular courses.`);
        }

        // --- Final Processing: Remove duplicates by ID and format ---
        const uniqueRecoMap = new Map();
        finalRecommendations.forEach(course => {
            if (course && course._id) { // Ensure course and _id exist
                 uniqueRecoMap.set(course._id.toString(), course);
            }
        });

        const finalCleanedRecommendations = Array.from(uniqueRecoMap.values())
            .slice(0, limit)
            .map(course => ({
                ...(course), // Spread the lean course object
                teacherName: course.teacher?.username || 'N/A',
                teacherId: course.teacher?._id?.toString() || null, // Ensure teacherId is string or null
                // teacher: undefined, // Remove full teacher object if already transformed
            }));

        console.log(`[Reco For You] Returning ${finalCleanedRecommendations.length} recommendations.`);
        res.status(200).json(finalCleanedRecommendations);

    } catch (error) {
        console.error("Error fetching personalized recommendations:", error);
        res.status(500).json({ message: "Failed to fetch recommendations for you" });
    }
};