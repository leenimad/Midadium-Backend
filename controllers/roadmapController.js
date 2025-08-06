// backend/controllers/roadmapController.js
const mongoose = require('mongoose');
const Course = require('../models/courseModel');
const Subject = require('../models/SubjectModel'); // If needed for context in prompts
const Enrollment = require('../models/EnrollmentModel'); // For auth checks if student controller doesn't handle it
const User = require('../models/UserModel');
const authMiddleware = require ('../middleware/authMiddleware');
const SavedRoadmap = require('../models/SavedRoadmapModel'); // Your new model
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// --- Initialize Google AI Client ---
let genAI;
if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log("[AI Roadmap] Gemini client initialized successfully.");
    } catch (e) {
        console.error("[AI Roadmap] CRITICAL: Failed to initialize Google Generative AI client:", e);
        genAI = null;
    }
} else {
    console.warn("[AI Roadmap] WARNING: GEMINI_API_KEY environment variable not set. AI features will be unavailable.");
    genAI = null;
}
// --- End AI Client Initialization ---

/**
 * @desc    Generate a learning roadmap based on a student's goal and available courses.
 * @route   POST /api/roadmaps/generate  (or /api/student/roadmaps/generate if in student controller)
 * @body    { learningGoal: string, currentKnowledgeLevel?: string (e.g., "beginner", "intermediate") }
 * @access  Private (Authenticated User - student)
 */
exports.generateLearningRoadmap = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Roadmap Generation Service is not configured or unavailable.' });
    }

    try {
        const { learningGoal, currentKnowledgeLevel } = req.body;
        const userId = req.user.id; // From 'protect' middleware

        if (!learningGoal || typeof learningGoal !== 'string' || learningGoal.trim().length < 5) {
            return res.status(400).json({ message: 'Please provide a clear learning goal (minimum 5 characters).' });
        }

        console.log(`[Roadmap] Generating roadmap for goal: "${learningGoal}", User: ${userId}`);

        // Fetch ALL approved courses for the catalog
        const availableCourses = await Course.find({ status: 'approved' })
            .select('name description subject keywords _id price')
            .populate('subject', 'name')
            .lean();

        if (availableCourses.length === 0) {
            return res.status(200).json({ // Return 200 but with a message
                roadmap: [],
                message: "No approved courses are currently available in our catalog to build a roadmap."
            });
        }

        const courseCatalogString = availableCourses.map((course, index) => {
            return `${index + 1}. ID: ${course._id}\n   Name: "${course.name}"\n   Subject: ${course.subject?.name || 'General'}\n   Description: ${(course.description || '').substring(0, 150)}...\n   Keywords: ${(course.keywords || []).join(', ') || 'N/A'}\n   Price: ${course.price > 0 ? '$'+course.price.toFixed(0) : 'Free'}`;
        }).join("\n\n");

        const prompt = `
            You are an expert curriculum designer.
            A student wants to achieve the learning goal: "${learningGoal}".
            ${currentKnowledgeLevel ? `Their current knowledge level is: "${currentKnowledgeLevel}".` : ''}

            Available Courses Catalog:
            --- CATALOG START ---
            ${courseCatalogString}
            --- CATALOG END ---

            Generate a structured learning roadmap with sequential phases. For each phase:
            1.  "phaseTitle": A brief title for the phase.
            2.  "recommendedCourseIds": An array of course IDs from the catalog for this phase.
            3.  "justification": 1-2 sentences explaining why these courses fit this phase.
            4.  "estimatedDuration": A general time estimate (e.g., "2-4 weeks", "1 month").

            Return ONLY a valid JSON object: { "roadmap": [ { "phaseTitle": "...", "recommendedCourseIds": ["id1", "id2"], "justification": "...", "estimatedDuration": "..." }, ... ] }
            If no relevant courses are found, return: { "roadmap": [], "message": "Could not find relevant courses for this goal." }
        `;

        console.log(`[Roadmap] Sending prompt to Gemini for goal: "${learningGoal}" (User: ${userId})`);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest", // Using flash for potentially faster responses
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
            ],
            generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
        });
        const result = await model.generateContent(prompt);
        const response = result.response;

        if (!response || !response.candidates || response.candidates.length === 0 || !response.text()) {
             const blockReason = response?.promptFeedback?.blockReason ?? "Unknown";
             const finishReason = response?.candidates?.[0]?.finishReason ?? "Unknown";
             console.error(`[Roadmap] No valid text response from AI. Block: ${blockReason}, Finish: ${finishReason}`);
             throw new Error(`AI did not provide a valid response for the roadmap. (Block: ${blockReason}, Finish: ${finishReason})`);
        }

        const aiResponseText = response.text();
        console.log("[Roadmap] Raw AI Response:", aiResponseText);

        let roadmapData;
        try {
            const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
            roadmapData = JSON.parse(cleanJsonString);
            if (!roadmapData.roadmap || !Array.isArray(roadmapData.roadmap)) { // Validate structure
                throw new Error("AI response for roadmap is not a valid array structure under 'roadmap' key.");
            }
        } catch (parseError) {
            console.error("[Roadmap] Failed to parse AI JSON response:", parseError, "\nRaw AI Text:", aiResponseText);
            return res.status(500).json({ message: "AI generated an invalid format for the roadmap. Please try rephrasing your goal." });
        }

        res.status(200).json(roadmapData);

    } catch (error) {
        console.error(`[Roadmap] Error generating learning roadmap for goal "${req.body.learningGoal}" (User: ${req.user.id}):`, error);
        res.status(500).json({ message: `Server error during roadmap generation: ${error.message || 'Unknown AI error'}` });
    }
};


/**
 * @desc    Save a generated learning roadmap for a student
 * @route   POST /api/student/roadmaps/save  (Ensure route matches studentRoutes.js)
 * @body    { learningGoal: string, currentKnowledgeLevel?: string, roadmap: Array<RoadmapStep> }
 * @access  Private (Student Only)
 */
exports.saveLearningRoadmap = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { learningGoal, currentKnowledgeLevel, roadmap } = req.body;

        if (!learningGoal || !roadmap || !Array.isArray(roadmap) || roadmap.length === 0) {
            return res.status(400).json({ message: 'Learning goal and roadmap steps are required to save.' });
        }

        // Basic validation of roadmap step structure
        for (const step of roadmap) {
            if (!step.phaseTitle || !step.recommendedCourseIds || !Array.isArray(step.recommendedCourseIds) || !step.justification || !step.estimatedDuration) {
                return res.status(400).json({ message: 'Each roadmap step must include phaseTitle, recommendedCourseIds (as array), justification, and estimatedDuration.' });
            }
        }

        const newSavedRoadmap = new SavedRoadmap({
            student: studentId,
            learningGoal: learningGoal.trim(),
            currentKnowledgeLevel: currentKnowledgeLevel?.trim(),
            roadmap: roadmap, // Assuming roadmap is already an array of objects matching RoadmapStepSchema
        });

        await newSavedRoadmap.save();
        console.log(`[Roadmap] Roadmap saved for student ${req.user.id}, Goal: "${learningGoal}"`);
        res.status(201).json({ message: 'Roadmap saved successfully!', savedRoadmap: newSavedRoadmap });

    } catch (error) {
        console.error(`[Roadmap] Error saving learning roadmap for student ${req.user.id}:`, error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: `Validation Error: ${error.message}` });
        }
        res.status(500).json({ message: 'Failed to save roadmap.' });
    }
};

// exports.saveLearningRoadmap = async (req, res) => {
//      let studentIdForLogging;
//     try {
//         const studentId = req.user.id;
//         const { learningGoal, currentKnowledgeLevel, roadmap } = req.body;

//         if (!learningGoal || !roadmap || !Array.isArray(roadmap) || roadmap.length === 0) {
//             return res.status(400).json({ message: 'Learning goal and roadmap steps are required.' });
//         }

//         // Basic validation of roadmap structure (can be more thorough)
//         for (const step of roadmap) {
//             if (!step.phaseTitle || !step.recommendedCourseIds || !step.justification || !step.estimatedDuration) {
//                 return res.status(400).json({ message: 'Each roadmap step is missing required fields.' });
//             }
//         }

//         const newSavedRoadmap = new SavedRoadmap({
//             student: studentId,
//             learningGoal: learningGoal,
//             currentKnowledgeLevel: currentKnowledgeLevel,
//             roadmap: roadmap, // The roadmap array from the client
//         });

//         await newSavedRoadmap.save();

//         res.status(201).json({ message: 'Roadmap saved successfully!', savedRoadmap: newSavedRoadmap });

//     } catch (error) {
//            const studentIdentifier = studentIdForLogging || (req.user ? req.user.id : 'Unknown Student');
//         console.error(`Error saving learning roadmap for student ${studentIdentifier}:`, error);
//         if (error.name === 'ValidationError') {
//             return res.status(400).json({ message: `Validation Error: ${error.message}` });
//         }
//         res.status(500).json({ message: 'Failed to save roadmap.' });
//     }
// };

/**
 * @desc    Get all saved roadmaps for the logged-in student
 * @route   GET /api/student/roadmaps (Ensure route matches studentRoutes.js)
 * @access  Private (Student Only)
 */
exports.getSavedRoadmaps = async (req, res) => {
    try {
        const studentId = req.user.id;
        console.log(`[Roadmap] Fetching saved roadmaps for student ${studentId}`);
        const savedRoadmaps = await SavedRoadmap.find({ student: studentId })
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(savedRoadmaps);
    } catch (error) {
        console.error(`[Roadmap] Error fetching saved roadmaps for student ${req.user.id}:`, error);
        res.status(500).json({ message: 'Failed to fetch saved roadmaps.' });
    }
};

/**
 * @desc    Get a single saved roadmap by its ID, populating course details for display
 * @route   GET /api/student/roadmaps/:roadmapId (Ensure route matches studentRoutes.js)
 * @access  Private (Student Only, owner of roadmap)
 */
exports.getSingleSavedRoadmap = async (req, res) => {
    try {
        const { roadmapId } = req.params;
        const studentId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(roadmapId)) {
            return res.status(400).json({ message: 'Invalid Roadmap ID format.' });
        }
        console.log(`[Roadmap] Fetching saved roadmap ID ${roadmapId} for student ${studentId}`);

        const savedRoadmap = await SavedRoadmap.findOne({ _id: roadmapId, student: studentId }).lean();

        if (!savedRoadmap) {
            return res.status(404).json({ message: 'Saved roadmap not found or you are not authorized to view it.' });
        }

        // Populate Course Details for each step for richer display
        for (let step of savedRoadmap.roadmap) {
             if (step.recommendedCourseIds && step.recommendedCourseIds.length > 0) {
                try {
                    step.populatedCourses = await Course.find({
                        '_id': { $in: step.recommendedCourseIds.map(id => new mongoose.Types.ObjectId(id)) },
                        'status': 'approved'
                    })
                    .select('name subject _id price teacher description') // Add description
                    .populate('subject', 'name')
                    .populate('teacher', 'username')
                    .lean();
                } catch (populateError) {
                    console.error(`[Roadmap] Error populating courses for roadmap step (RoadmapID: ${roadmapId}):`, populateError);
                    step.populatedCourses = [];
                }
             } else {
                 step.populatedCourses = [];
             }
        }

        res.status(200).json(savedRoadmap);
    } catch (error) {
        console.error(`[Roadmap] Error fetching single saved roadmap ID ${req.params.roadmapId}:`, error);
        res.status(500).json({ message: 'Failed to fetch saved roadmap details.' });
    }
};

/**
 * @desc    Delete a saved roadmap
 * @route   DELETE /api/student/roadmaps/:roadmapId (Ensure route matches studentRoutes.js)
 * @access  Private (Student Only, owner of roadmap)
 */
exports.deleteSavedRoadmap = async (req, res) => {
    try {
        const { roadmapId } = req.params;
        const studentId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(roadmapId)) {
            return res.status(400).json({ message: 'Invalid Roadmap ID format.' });
        }
        console.log(`[Roadmap] Deleting roadmap ID ${roadmapId} for student ${studentId}`);

        const result = await SavedRoadmap.deleteOne({ _id: roadmapId, student: studentId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Saved roadmap not found or you are not authorized to delete it.' });
        }
        res.status(200).json({ message: 'Roadmap deleted successfully.' });
    } catch (error) {
        console.error(`[Roadmap] Error deleting saved roadmap ID ${req.params.roadmapId}:`, error);
        res.status(500).json({ message: 'Failed to delete roadmap.' });
    }
};
/**
 * @desc    Initiate purchase for a package of courses from a roadmap
 * @route   POST /api/student/roadmaps/purchase-package
 * @body    { courseIds: [String], learningGoal?: String (for context) }
 * @access  Private (Student Only)
 */
exports.purchaseRoadmapPackage = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseIds, learningGoal } = req.body; // Array of course IDs from the roadmap

        if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
            return res.status(400).json({ message: 'Course IDs for the package are required.' });
        }

        console.log(`[RoadmapPurchase] Student ${studentId} initiating purchase for ${courseIds.length} courses.`);

        // --- Step 1: Validate Course IDs and Filter for Unenrolled, Priced Courses ---
        const validCourseObjectIds = courseIds
            .filter(id => mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));

        if (validCourseObjectIds.length !== courseIds.length) {
            return res.status(400).json({ message: 'Some provided course IDs are invalid.' });
        }

        const coursesToPurchaseDetails = await Course.find({
            _id: { $in: validCourseObjectIds },
            status: 'approved' // Only approved courses
        }).select('name price _id').lean();

        if (coursesToPurchaseDetails.length === 0) {
            return res.status(400).json({ message: 'No valid, approved courses found for purchase in the provided list.' });
        }

        // Find which of these courses the student is NOT already enrolled in
        const existingEnrollments = await Enrollment.find({
            student: studentId,
            course: { $in: coursesToPurchaseDetails.map(c => c._id) }
        }).select('course').lean();
        const enrolledCourseIdsSet = new Set(existingEnrollments.map(e => e.course.toString()));

        const finalCoursesForPayment = coursesToPurchaseDetails.filter(
            course => !enrolledCourseIdsSet.has(course._id.toString()) && course.price > 0
        );

        if (finalCoursesForPayment.length === 0) {
            return res.status(200).json({ // 200 OK because no payment needed
                message: 'You are already enrolled in all selected paid courses or they are free.',
                requiresPayment: false,
                clientSecret: null
            });
        }

        // --- Step 2: Calculate Total Amount ---
        let totalAmount = 0;
        finalCoursesForPayment.forEach(course => {
            totalAmount += course.price;
        });
        const totalAmountInCents = Math.round(totalAmount * 100);

        if (totalAmountInCents < 50) { // Stripe minimum
            // This might happen if the only remaining courses are very low priced.
            // You might decide to make them "free" effectively or handle differently.
            // For now, if it's below Stripe min, treat as if no payment required / enroll directly for these
            // This is complex logic, for now let's assume total > 0.50 if it gets here.
             console.warn(`[RoadmapPurchase] Total amount ${totalAmountInCents} is less than Stripe minimum for package.`);
             // Fallback: Process as free if it's a rounding issue to zero, or throw specific error.
             // For now, let's assume if this branch is hit, it's a valid amount.
        }

        // --- Step 3: Create ONE Stripe Payment Intent for the Package ---
        if (!process.env.STRIPE_SECRET_KEY) { throw new Error('Stripe configuration missing.'); }

        const courseIdsForMetadata = finalCoursesForPayment.map(c => c._id.toString());

        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmountInCents,
            currency: 'usd', // Or your currency
            metadata: {
                studentId: studentId.toString(),
                purchaseType: 'roadmap_package', // Identifier for webhook
                roadmapCourseIds: JSON.stringify(courseIdsForMetadata), // Send as JSON string
                learningGoal: learningGoal || 'Roadmap Package', // Optional context
            },
            automatic_payment_methods: { enabled: true },
        });

        console.log(`[RoadmapPurchase] Payment Intent ${paymentIntent.id} created for package. Total: ${totalAmountInCents/100}`);
        res.status(200).json({
            message: `Payment required for ${finalCoursesForPayment.length} course(s). Total: $${totalAmount.toFixed(2)}`,
            clientSecret: paymentIntent.client_secret,
            requiresPayment: true,
            totalAmount: totalAmount,
            courseCount: finalCoursesForPayment.length
        });
 
    } catch (error) {
        console.error(`[RoadmapPurchase] Error processing package purchase for student ${req.user?.id}:`, error);
        res.status(500).json({ message: `Failed to initiate package purchase: ${error.message}` });
    }
};