const User = require('../models/UserModel');
const Course = require('../models/courseModel');
const Lesson = require('../models/LessonModel');
const mongoose = require('mongoose');
const Subject = require('../models/SubjectModel'); // Import Subject model
const { v4: uuidv4 } = require('uuid');
const Enrollment = require('../models/EnrollmentModel');
const bcrypt = require('bcryptjs');
const Assignment = require('../models/AssignmentModel');
const Submission = require('../models/SubmissionModel');
const { createNotification } = require('./notificationController');
const Review = require('../models/reviewModel');
const CourseReviewAnalysis = require('../models/CourseReviewAnalysisModel'); // Import  model
const Certificate= require ('../models/CertificateModel');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
let genAI;
if (process.env.GEMINI_API_KEY) { genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); }






exports.getMyStudents = async (req, res) => {
try {
const teacherId = req.user.id;

// 1. احصل على كل الكورسات الخاصة بالمعلم
const teacherCourses = await Course.find({ teacher: teacherId }).select('_id');
const courseIds = teacherCourses.map(course => course._id);

// 2. استرجع كل الطلاب المسجلين في هذه الكورسات
const enrollments = await Enrollment.find({ course: { $in: courseIds } })
.populate('student', 'username email') // اختر الحقول التي تريد إظهارها
.lean();

// 3. إزالة التكرار (في حال كان الطالب مسجل في أكثر من كورس)
const studentMap = new Map();
enrollments.forEach(enrollment => {
if (enrollment.student && enrollment.student._id) {
studentMap.set(enrollment.student._id.toString(), enrollment.student);
}
});

const uniqueStudents = Array.from(studentMap.values());

return res.status(200).json(uniqueStudents);
} catch (err) {
console.error('Failed to get teacher students:', err);
res.status(500).json({ message: 'Failed to get students' });
}
};

exports.getMyCourses = async (req, res) => {
try {
const teacherId = req.user.id;
const courses = await Course.find({ teacher: teacherId }).populate('subject', 'name _id');
//.populate('students', 'username email grade');
res.status(200).json(courses);
} catch (err) {
console.error('Failed to fetch teacher courses:', err);
res.status(500).json({ message: 'Failed to fetch courses' });
}
};

exports.getMyLessons = async (req, res) => {
try {
const teacherId = req.user.id;
const { course } = req.query;

const filter = { teacher: teacherId };
if (course) {
filter.course = course;
}

const lessons = await Lesson.find(filter).sort({ createdAt: -1 });
res.status(200).json(lessons);
} catch (err) {
console.error('Failed to get lessons:', err);
res.status(500).json({ message: 'Failed to get lessons' });
}
};




exports.getWeeklyLessonStats = async (req, res) => {
try {
const teacherId = req.user.id;
const startOfWeek = new Date();
startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
startOfWeek.setHours(0, 0, 0, 0);

const lessons = await Lesson.find({
teacher: teacherId,
createdAt: { $gte: startOfWeek }
});

const stats = Array(7).fill(0);
lessons.forEach(lesson => {
const day = new Date(lesson.createdAt).getDay();
stats[day]++;
});

res.status(200).json(stats);
} catch (err) {
console.error('Error fetching lesson stats:', err);
res.status(500).json({ message: 'Failed to fetch lesson stats' });
}
};

exports.addCourse = async (req, res) => {
  try {
    const { name, description, subject, grade, syllabus, resources, price } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    let teacherId;

    if (userRole === 'teacher') {
      teacherId = userId;
    } else if (userRole === 'admin') {
      if (!req.body.teacher || !mongoose.Types.ObjectId.isValid(req.body.teacher)) {
        return res.status(400).json({ message: 'Admin must provide valid teacher ID.' });
      }
      teacherId = req.body.teacher;
    } else {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // validate required fields
    if (!name || !description || !subject || price === undefined || price === null) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    const subjectObj = await Subject.findOne({ name: subject });
    if (!subjectObj) {
      return res.status(400).json({ message: 'Subject not found.' });
    }

    const course = new Course({
      name,
      description,
      teacher: teacherId,
      subject: subjectObj._id,
      grade,
      syllabus,
      resources,
      price,
      status: 'pending'
    });

    await course.save();
    await User.findByIdAndUpdate(teacherId, { $addToSet: { courses: course._id } });

    return res.status(201).json({ message: 'Course created', course });
  } catch (err) {
    console.error('Error adding course:', err);
    res.status(500).json({ message: 'Failed to create course' });
  }
};

exports.getTeacherProfile = async (req, res) => {
try {
const teacher = await User.findById(req.user.id).select('id username email role courses');

if (!teacher) {
return res.status(404).json({ message: 'Teacher not found' });
}

res.status(200).json({
id: teacher.id,
username: teacher.username,
email: teacher.email,
role: teacher.role,
courses: teacher.courses,
});
} catch (error) {
console.error('Error fetching teacher profile:', error);
res.status(500).json({ message: 'Server error' });
}
};

// controller function
exports.getStudentsForCourse = async (req, res) => {
try {
const courseId = req.params.id;

const enrollments = await Enrollment.find({ course: courseId })
.populate('student', 'username email') // فقط الحقول التي تحتاجها
.lean();

const students = enrollments.map(enroll => enroll.student);

res.status(200).json(students);
} catch (err) {
console.error('Error fetching enrolled students:', err);
res.status(500).json({ message: 'Failed to get students for course' });
}
};

exports.changeTeacherPassword = async (req, res) => {
try {
const { currentPassword, newPassword } = req.body;

const teacher = await User.findById(req.user.id);
if (!teacher) {
return res.status(404).json({ message: 'Teacher not found' });
}

const isMatch = await bcrypt.compare(currentPassword, teacher.password);
if (!isMatch) {
return res.status(400).json({ message: 'Current password is incorrect' });
}

teacher.password = newPassword;
await teacher.save();

res.status(200).json({ message: 'Password updated successfully' });
} catch (error) {
console.error('Error changing password:', error);
res.status(500).json({ message: 'Server error changing password' });
}
};
exports.updateTeacherProfile = async (req, res) => {
try {
const { username, email } = req.body;

const teacher = await User.findById(req.user.id);
if (!teacher) {
return res.status(404).json({ message: 'Teacher not found' });
}

teacher.username = username || teacher.username;
teacher.email = email || teacher.email;

await teacher.save();

res.status(200).json({ message: 'Profile updated successfully' });
} catch (error) {
console.error('Error updating teacher profile:', error);
res.status(500).json({ message: 'Server error updating profile' });
}
};


exports.reviewSubmission = async (req, res) => {
  try {
    const { rating, review } = req.body;
    const submissionId = req.params.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const updatedSubmission = await Submission.findByIdAndUpdate(
      submissionId,
      { rating, review },
      { new: true }
    ).populate('student assignment');

    if (!updatedSubmission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // ✅ Save notification in DB
    await createNotification({
  userId: updatedSubmission.student._id,
  title: '⭐ You received a review',
  message: `You got a ${rating}-star review for "${updatedSubmission.assignment.title}".`,
  type: 'review',
  link: `/student/assignments/${updatedSubmission.assignment._id}/submission`
});


    // ✅ Emit notification in real-time using Socket.IO (INSIDE the function!)
    const io = req.app.get('io');
    const studentId = updatedSubmission.student._id.toString();

    if (io && studentId) {
      io.to(studentId).emit('notification', {
        title: '⭐ You received a review',
        message: `You got a ${rating}-star review for "${updatedSubmission.assignment.title}".`,
        type: 'review',
        assignmentId: updatedSubmission.assignment._id,
      });
    }

    res.status(200).json({
      message: 'Review added and notification sent successfully',
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('Review error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};




exports.getAssignmentsForCourse = async (req, res) => {
try {
const courseId = req.params.courseId;
const teacherId = req.user._id;

// Ensure teacher owns this course (optional check for authorization)
const assignments = await Assignment.find({ course: courseId, teacher: teacherId }).sort({ createdAt: -1 });

res.status(200).json(assignments);
} catch (err) {
console.error('Error fetching assignments for course:', err);
res.status(500).json({ message: 'Server error fetching assignments' });
}
};  

// exports.analyzeCourseReviews = async (req, res) => {
//   if (!genAI) {
//     return res.status(503).json({ message: 'AI Service not available.' });
//   }

//   try {
//     const { courseId } = req.params;
//     const teacherId = req.user.id; // From 'protect' middleware

//     if (!mongoose.Types.ObjectId.isValid(courseId)) {
//       return res.status(400).json({ message: 'Invalid Course ID.' });
//     }

//     // 1. Fetch Course and verify teacher ownership
//     const course = await Course.findById(courseId)
//       .select('name description objectives teacher ratingAverage')
//       .lean();

//     if (!course) {
//       return res.status(404).json({ message: 'Course not found.' });
//     }

//     if (course.teacher.toString() !== teacherId && req.user.role !== 'admin') {
//       return res.status(403).json({ message: 'Not authorized to analyze reviews for this course.' });
//     }

//     // 2. Fetch all reviews for the course
//     const reviews = await Review.find({ courseId }).select('rating comment createdAt studentName').lean();

//     if (reviews.length < 5) {
//       return res.status(400).json({
//         message: 'Not enough reviews to perform a meaningful analysis yet. At least 5 reviews are recommended.',
//       });
//     }

//     // 3. Prepare data for the AI prompt
//     let reviewsText = reviews
//       .map(r => `Rating: ${r.rating}/5\nComment: ${r.comment}\nBy: ${r.studentName || 'Anonymous'}\n---`)
//       .join('\n\n');

//     if (reviewsText.length > 15000) {
//       reviewsText = reviewsText.substring(0, 15000) + '... (reviews truncated)';
//     }

//     // 4. Construct the Prompt for Gemini
//     const analysisPrompt = `
//       You are an expert instructional design analyst. Your task is to analyze student reviews for an online course and provide actionable feedback to the teacher.

//       Course Title: "${course.name}"
//       Course Description: "${course.description || 'No description provided.'}"
//       Course Learning Objectives: "${course.objectives || 'No objectives provided.'}"

//       Here are the student reviews:
//       """
//       ${reviewsText}
//       """

//       Based on ALL the provided reviews and course information, please provide the following:
//       1. Overall Sentiment: Briefly describe the general student sentiment. *Choose ONLY from the following values: "positive", "neutral", "mixed", "negative".*
//       2. Key Strengths: Identify 2-3 main strengths of the course highlighted by students.
//       3. Areas for Improvement: Identify 2-3 primary areas where the course could be improved based on student feedback or recurring issues.
//       4. Actionable Tips for the Teacher: Provide 3-5 specific, actionable suggestions... For each tip, assign a category. *The category MUST be one of the following exact values: "strength", "weakness", "suggestion", "clarification_needed", "content_gap".*

//       Format your entire response ONLY as a valid JSON object with the following exact keys:
//       {
//         "overallSentiment": "string",
//         "keyStrengths": ["string array"],
//         "areasForImprovement": ["string array"],
//         "actionableTips": [
//           { "category": "string", "description": "Detailed tip for the teacher." }
//         ]
//       }
//     `;

//     console.log(`[AI ReviewAnalysis] Analyzing reviews for Course ${courseId}... Prompt length: ${analysisPrompt.length}`);

//     // 5. Call Gemini API
//     const model = genAI.getGenerativeModel({
//       model: 'gemini-1.5-flash-latest',
//       safetySettings: [
//         { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//         { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//         { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
//         { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
//       ],
//       generationConfig: {
//         temperature: 0.6,
//         maxOutputTokens: 1500
//       }
//     });

//     const result = await model.generateContent(analysisPrompt);
//     const response = result.response;

//     if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
//       const blockReason = response?.promptFeedback?.blockReason;
//       const finishReason = response?.candidates?.[0]?.finishReason;
//       throw new Error(`AI did not provide a valid analysis. Block: ${blockReason}, Finish: ${finishReason}`);
//     }

//     const aiResponseText = response.text();
//     const cleanJsonString = aiResponseText.replace(/^json\s*([\s\S]*?)\s*$/gm, '$1').trim();

//     let analysisData;
//     try {
//       analysisData = JSON.parse(cleanJsonString);
//     } catch (e) {
//       console.error('[AI ReviewAnalysis] Failed to parse AI JSON response:', aiResponseText);
//       throw new Error('AI returned an invalid JSON format for analysis.');
//     }

//     if (
//       !analysisData.overallSentiment ||
//       !Array.isArray(analysisData.keyStrengths) ||
//       !Array.isArray(analysisData.areasForImprovement) ||
//       !Array.isArray(analysisData.actionableTips)
//     ) {
//       throw new Error('AI analysis JSON structure is missing required fields.');
//     }

//     // 7. Save Analysis to DB
//     const currentAvgRating =
//       course.ratingAverage || reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

//     const savedAnalysis = await CourseReviewAnalysis.findOneAndUpdate(
//       { course: courseId },
//       {
//         course: courseId,
//         lastAnalyzedAt: new Date(),
//         overallSentiment: analysisData.overallSentiment,
//         averageRatingAtAnalysis: currentAvgRating,
//         reviewCountAtAnalysis: reviews.length,
//         keyStrengths: analysisData.keyStrengths,
//         areasForImprovement: analysisData.areasForImprovement,
//         actionableTips: analysisData.actionableTips,
//         rawAIResponse: aiResponseText
//       },
//       { new: true, upsert: true, runValidators: true }
//     );

//     console.log(`[AI ReviewAnalysis] Analysis saved for Course ${courseId}`);
//     res.status(200).json({ message: 'Review analysis completed.', analysis: savedAnalysis });

//   } catch (error) {
//     console.error(`[AI ReviewAnalysis] Error analyzing reviews for course ${req.params.courseId}:`, error);
//     res.status(500).json({ message: `Failed to analyze course reviews: ${error.message}` });
//   }
// };
exports.analyzeCourseReviews = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Service not available.' });
    }

    try {
        const { courseId } = req.params;
        const teacherId = req.user.id; // From 'protect' middleware

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID.' });
        }

        // 1. Fetch Course and verify teacher ownership
        const course = await Course.findById(courseId).select('name description objectives teacher').lean();
        if (!course) { return res.status(404).json({ message: 'Course not found.' }); }
        if (course.teacher.toString() !== teacherId && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized to analyze reviews for this course.' });
        }

        // 2. Fetch all reviews for the course
        const reviews = await Review.find({ courseId: courseId }).select('rating comment createdAt studentName').lean();
        if (reviews.length < 5) { // Arbitrary minimum number of reviews for meaningful analysis
            return res.status(400).json({ message: 'Not enough reviews to perform a meaningful analysis yet. At least 5 reviews are recommended.' });
        }

        // 3. Prepare data for the AI prompt
        let reviewsText = reviews.map(r => `Rating: ${r.rating}/5\nComment: ${r.comment}\nBy: ${r.studentName || 'Anonymous'}\n---`).join('\n\n');
        if (reviewsText.length > 15000) { // Truncate if too long for prompt limits (adjust limit)
            reviewsText = reviewsText.substring(0, 15000) + "... (reviews truncated)";
        }


        // 4. Construct the Prompt for Gemini
        const analysisPrompt = `
            You are an expert instructional design analyst. Your task is to analyze student reviews for an online course and provide actionable feedback to the teacher.

            Course Title: "${course.name}"
            Course Description: "${course.description || 'No description provided.'}"
            Course Learning Objectives: "${course.objectives || 'No objectives provided.'}"

            Here are the student reviews:
            """
            ${reviewsText}
            """

            Based on ALL the provided reviews and course information, please provide the following:
            1.  Overall Sentiment: Briefly describe the general student sentiment. **Choose ONLY from the following values: "positive", "neutral", "mixed", "negative".**
            2.  Key Strengths: Identify 2-3 main strengths of the course highlighted by students.
            3.  Areas for Improvement: Identify 2-3 primary areas where the course could be improved based on student feedback or recurring issues.
            4.  Actionable Tips for the Teacher: Provide 3-5 specific, actionable suggestions... For each tip, assign a category. **The category MUST be one of the following exact values: "strength", "weakness", "suggestion", "clarification_needed", "content_gap".**

                Format your entire response ONLY as a valid JSON object with the following exact keys:
                "overallSentiment": "string (must be one of 'positive', 'neutral', 'mixed', 'negative',  'overwhelmingly_positive',     
                'mostly_positive',            
                'mostly_negative',            
                'mostly_positive_with_concerns' )",
                "keyStrengths": ["string array"],
                "areasForImprovement": ["string array"],
                "actionableTips": [
                    { "category": "string (must be one of 'strength', 'weakness', 'suggestion', 'clarification_needed', 'content_gap')", "description": "Detailed tip for the teacher." },
                    ...
                ]
                Ensure the "actionableTips" category values are from the provided list.
        `;

        console.log(`[AI ReviewAnalysis] Analyzing reviews for Course ${courseId}... Prompt length: ${analysisPrompt.length}`);

        // 5. Call Gemini API
        const model = genAI.getGenerativeModel({
              
            model: "gemini-1.5-flash-latest",
            safetySettings: [ // Define safety settings explicitly
               { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
               { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
             ],
       
             generationConfig: { temperature: 0.6, maxOutputTokens: 1500 } // Allow more tokens for analysis

        });
        const result = await model.generateContent(analysisPrompt);
        const response = result.response;

        // 6. Process LLM Response
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
             const blockReason = response?.promptFeedback?.blockReason;
             const finishReason = response?.candidates?.[0]?.finishReason;
             throw new Error(`AI did not provide a valid analysis. Block: ${blockReason}, Finish: ${finishReason}`);
        }
        const aiResponseText = response.text();
        const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
        let analysisData;
        try {
            analysisData = JSON.parse(cleanJsonString);
        } catch (e) {
             console.error("[AI ReviewAnalysis] Failed to parse AI JSON response:", aiResponseText);
             throw new Error("AI returned an invalid JSON format for analysis.");
        }

        // Basic validation of the parsed structure
        if (!analysisData.overallSentiment || !Array.isArray(analysisData.keyStrengths) || !Array.isArray(analysisData.areasForImprovement) || !Array.isArray(analysisData.actionableTips)) {
            throw new Error("AI analysis JSON structure is missing required fields.");
        }

        // 7. Save Analysis to DB
        const currentAvgRating = course.ratingAverage || (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length);

        const savedAnalysis = await CourseReviewAnalysis.findOneAndUpdate(
            { course: courseId },
            {
                course: courseId,
                lastAnalyzedAt: new Date(),
                overallSentiment: analysisData.overallSentiment,
                averageRatingAtAnalysis: currentAvgRating,
                reviewCountAtAnalysis: reviews.length,
                keyStrengths: analysisData.keyStrengths,
                areasForImprovement: analysisData.areasForImprovement,
                actionableTips: analysisData.actionableTips, // Assumes AI returns tips matching TipSchema
                rawAIResponse: aiResponseText // Store for reference
            },
            { new: true, upsert: true, runValidators: true }
        );

        console.log(`[AI ReviewAnalysis] Analysis saved for Course ${courseId}`);
        res.status(200).json({ message: "Review analysis completed.", analysis: savedAnalysis });

    } catch (error) {
        console.error(`[AI ReviewAnalysis] Error analyzing reviews for course ${req.params.courseId}:`, error);
        res.status(500).json({ message: `Failed to analyze course reviews: ${error.message}` });
    }
};
/**
 * @desc    Get students enrolled in a specific course with their assignment performance for certificate consideration.
 * @route   GET /api/teacher/courses/:courseId/students-performance
 * @access  Private (Teacher Only, owner of course)
 */
exports.getCourseStudentsWithPerformance = async (req, res) => {
 
    try {
        const { courseId } = req.params;
        // let teacherId;
        // teacherId = req.body.teacher;
const teacherId = req.user.id;
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID.' });
        }
       
        // 1. Verify teacher owns the course
        const course = await Course.findOne({ _id: courseId, teacher: teacherId }).lean();
        if (!course) {
            return res.status(403).json({ message: 'Course not found or you are not authorized.' });
        }

        // 2. Get all assignments for this course
        const assignments = await Assignment.find({ course: courseId }).select('_id title').lean();
        const assignmentIds = assignments.map(a => a._id);

        // 3. Get enrollments for this course
        const enrollments = await Enrollment.find({ course: courseId })
            .populate('student', 'username email _id') // Populate student details
            .lean();

        if (enrollments.length === 0) {
            return res.status(200).json([]); // No students enrolled
        }

        // 4. For each student, fetch their submissions for this course's assignments and calculate average rating
        const studentsWithPerformance = await Promise.all(
            enrollments.map(async (enrollment) => {
                if (!enrollment.student) return null; // Should not happen if populate works

                const studentSubmissions = await Submission.find({
                    student: enrollment.student._id,
                    assignment: { $in: assignmentIds },
                    rating: { $exists: true, $ne: null } // Only consider rated submissions
                }).select('rating').lean();

                let averageRating = 0;
                let gradedAssignmentsCount = 0;
                if (studentSubmissions.length > 0) {
                    const totalRating = studentSubmissions.reduce((sum, sub) => sum + (sub.rating || 0), 0);
                    gradedAssignmentsCount = studentSubmissions.length;
                    averageRating = totalRating / gradedAssignmentsCount;
                }

                // Check if a certificate already issued
                const certificate = await Certificate.findOne({ student: enrollment.student._id, course: courseId }).select('_id completionDate').lean();

                return {
                    studentId: enrollment.student._id,
                    username: enrollment.student.username,
                    email: enrollment.student.email,
                    averageAssignmentRating: gradedAssignmentsCount > 0 ? parseFloat((averageRating * 20).toFixed(2)) : null, // converted to out of 100 null if no graded assignments
                    gradedAssignmentsCount: gradedAssignmentsCount,
                    totalAssignmentsInCourse: assignments.length,
                    hasCertificate: !!certificate, // True if certificate exists
                    certificateId: certificate?._id?.toString(), // existing certificate ID   
                     certificateIssueDate: certificate?.completionDate
                };
            })
        );

        res.status(200).json(studentsWithPerformance.filter(s => s !== null));

    } catch (error) {
        console.error("Error fetching students' performance for course:", error);
        res.status(500).json({ message: "Failed to fetch student performance." });
    }
};


/**
 * @desc    Issue a certificate to a student for a specific course
 * @route   POST /api/teacher/courses/:courseId/students/:studentId/issue-certificate
 * @access  Private (Teacher Only, owner of course)
 */
exports.issueCertificateToStudent = async (req, res) => {
    try {
        const { courseId, studentId } = req.params;
         const teacherId = req.user.id;
        // let teacherId;
        // teacherId = req.body.teacher;
        if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ message: 'Invalid Course or Student ID.' });
        }

        // 1. Verify teacher owns the course
        const course = await Course.findById(courseId).select('name teacher').lean();
        if (!course || course.teacher.toString() !== teacherId) {
            return res.status(403).json({ message: 'Course not found or you are not authorized.' });
        }

        // 2. Verify student is enrolled
        const enrollment = await Enrollment.findOne({ student: studentId, course: courseId });
        if (!enrollment) {
            return res.status(404).json({ message: 'Student not enrolled in this course.' });
        }

        // 3. Check if certificate already exists
        let certificate = await Certificate.findOne({ student: studentId, course: courseId });
        if (certificate) {
            return res.status(400).json({ message: 'Certificate already issued to this student for this course.', certificate });
        }

        // 4. Get student details for the certificate
        const studentUser = await User.findById(studentId).select('username').lean();
        if (!studentUser) {
            return res.status(404).json({ message: 'Student user not found.' });
        }

        // 5. Create and save the new certificate
        const newCertificate = new Certificate({
            student: studentId,
            course: courseId,
            courseName: course.name,
            studentName: studentUser.username,
            completionDate: new Date(), // Or allow teacher to set a date
            certificateId: `MID-${courseId.toString().slice(-4)}-${studentId.toString().slice(-6)}-${uuidv4().slice(0, 6)}` // Unique ID
        });
        await newCertificate.save();

        // 6. Send notification to student
        await createNotification({
            userId: studentId,
            title: '🏆 Certificate Awarded!',
            message: `Congratulations! You have been awarded a certificate for completing the course: "${course.name}".`,
            link: `/student/certificates/${newCertificate._id}`, // Link to view certificate (needs frontend route)
            type: 'success'
        });

        console.log(`Certificate ${newCertificate.certificateId} issued to student ${studentId} for course ${courseId} by teacher ${teacherId}`);
        res.status(201).json({ message: 'Certificate issued successfully!', certificate: newCertificate });

    } catch (error) {
        console.error("Error issuing certificate:", error);
        res.status(500).json({ message: `Failed to issue certificate: ${error.message}` });
    }
};
/**
 * @desc    Use AI to automatically rate a student's submission
 * @route   POST /api/teacher/submissions/:submissionId/auto-rate
 * @access  Private (Teacher Only, owner of course/assignment)
 */
exports.autoRateSubmission = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Grading Service not available.' });
    }

    try {
        const { submissionId } = req.params;
        const teacherId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return res.status(400).json({ message: 'Invalid Submission ID.' });
        }

        // 1. Fetch the submission and populate related data for context and authorization
        const submission = await Submission.findById(submissionId)
            .populate({
                path: 'assignment',
                select: 'title description course',
                populate: { // Nested populate
                    path: 'course',
                    select: 'teacher lessons', // Need teacher for auth, lessons for transcript
                    // populate: {
                    //    // path: 'lessons',
                    //  //   select: 'transcript title', // Get all lesson transcripts in the course
                    // }
                }
            })
            .lean();

        if (!submission) {
            return res.status(404).json({ message: 'Submission not found.' });
        }
        if (!submission.assignment?.course?.teacher) {
            return res.status(404).json({ message: 'Course or teacher associated with this submission could not be found.' });
        }

        // 2. Authorization Check: Ensure the requesting user is the teacher of the course
        if (submission.assignment.course.teacher.toString() !== teacherId) {
            return res.status(403).json({ message: 'Not authorized to grade submissions for this course.' });
        }
 const studentSubmissionText = submission.content?.trim();
        if (!studentSubmissionText || studentSubmissionText.length === 0) {
             return res.status(400).json({ message: 'Submission has no text content to evaluate with AI. Please grade manually.' });
        }
          // 4. Consolidate lesson transcripts into a single context block
        const lessonContext = (submission.assignment.course.lessons || [])
            .map(lesson => `Lesson: "${lesson.title}"\nTranscript: ${lesson.transcript || 'No transcript available for this lesson.'}`)
            .join('\n\n---\n\n');

        // if (!lessonContext || lessonContext.trim().length === 0) {
        //     // This is a course-level issue, but worth checking.
        //     return res.status(400).json({ message: 'No lesson transcripts available for this course to use as a grading reference.' });
        // }
        // TODO: If submission is a file, you'd need logic to extract text from PDF/DOCX first.
        // For now, this implementation focuses on text-based submissions in `submission.content`.
        // const studentSubmissionText = submission.content || "Student did not provide text content.";


        // 4. Construct the Prompt for Gemini
        const gradingPrompt = `
            You are an expert, fair, and constructive teacher grading a student's assignment submission.

            Assignment Title: "${submission.assignment.title}"
            Assignment Description/Question: "${submission.assignment.description}"

            Here is the content of the student's submission:
            """
            ${studentSubmissionText}
            """

            Evaluate this submission based on the context from the lesson(s) in this course:
            --- LESSON CONTEXT START ---
            ${lessonContext}
            --- LESSON CONTEXT END ---

            Based on the assignment requirements and the lesson context, please perform the following:
            1.  Assign a numerical rating from 1 to 5, where 1 is poor and 5 is excellent.
            2.  Write a brief, constructive review (2-4 sentences) explaining the reason for your rating. Highlight what the student did well and where they could improve, referencing the lesson context if possible.

            Return your evaluation ONLY as a valid JSON object with the following exact keys:
            - "rating": number (integer from 1 to 5)
            - "review": "string (your constructive feedback)"

            Example of desired JSON output:
            {"rating": 4, "review": "Excellent work on identifying the core concepts. To improve, try to provide a more specific example from the 'Advanced Widgets' lesson to support your final point."}
        `;

        console.log(`[AI Auto-Rate] Grading submission ${submissionId} for teacher ${teacherId}...`);
        // console.log("Prompt:", gradingPrompt); // For debugging

        // 5. Call Gemini API
//         const safetySettings = [
//   {
//     category: "HARM_CATEGORY_HARASSMENT",
//     threshold: "BLOCK_MEDIUM_AND_ABOVE",
//   },
//   {
//     category: "HARM_CATEGORY_HATE_SPEECH",
//     threshold: "BLOCK_MEDIUM_AND_ABOVE",
//   },
//   {
//     category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
//     threshold: "BLOCK_MEDIUM_AND_ABOVE",
//   },
//   {
//     category: "HARM_CATEGORY_DANGEROUS_CONTENT",
//     threshold: "BLOCK_MEDIUM_AND_ABOVE",
//   },
// ];

// Define generation configuration (optional, for tuning)
// const generationConfig = {
//   temperature: 0.7,
//   topK: 40,
//   topP: 0.95,
//   maxOutputTokens: 1024,
// };

// Use the free "gemini-pro" model with configs
  const model = genAI.getGenerativeModel({
                 model: "gemini-1.5-flash-latest",
                 safetySettings: [ // Define safety settings explicitly
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                  ],
                  generationConfig: {
                     temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 1024,
                  },
             });
    
        const result = await model.generateContent(gradingPrompt);
        const response = result.response;

        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('AI did not provide a valid grading response.');
        }

        const aiResponseText = response.text();
        let aiGradingData;
        try {
            const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
            aiGradingData = JSON.parse(cleanJsonString);
            if (typeof aiGradingData.rating !== 'number' || typeof aiGradingData.review !== 'string') {
                throw new Error("AI response missing 'rating' or 'review' fields.");
            }
        } catch (e) {
            console.error("[AI Auto-Rate] Failed to parse AI JSON response:", aiResponseText);
            throw new Error("AI returned an invalid format for the grade.");
        }

        // 6. Update the Submission document in MongoDB
        const clampedRating = Math.min(5, Math.max(1, Math.round(aiGradingData.rating)));
         const aiReviewText = `[AI-Assisted Review]: ${aiGradingData.review}`;
        const updatedSubmission = await Submission.findByIdAndUpdate(
            submissionId,
            {
                rating: clampedRating,
                 review: aiReviewText,// The feedback from the AI
                reviewDate: new Date(),
              //  isRatedByAI: true, // Flag that it was AI-rated
                //aiRatingJustification: aiGradingData.review, // Can store the same text here
            },
            { new: true } // Return the updated document
        ).populate('student', 'username'); // Repopulate student to get name for notification

        if (!updatedSubmission) {
            throw new Error("Could not find and update the submission after AI grading.");
        }
        console.log(`[AI Auto-Rate] Submission ${submissionId} updated with AI rating: ${clampedRating}`);

        // 7. Send notification to student
        await createNotification({
            userId: updatedSubmission.student._id,
            title: '✅ Your assignment has been graded!',
            message: `Your submission for "${submission.assignment.title}" has been reviewed. You received a rating of ${clampedRating}/5.`,
            link: `/student/assignments/${submission.assignment._id}/submission/${submissionId}`, // Deep link
            type: 'review'
        });

        res.status(200).json({ message: 'Submission auto-rated successfully!', submission: updatedSubmission });

    } catch (error) {
        console.error(`[AI Auto-Rate] Error auto-rating submission ${req.params.submissionId}:`, error);
        res.status(500).json({ message: `Failed to auto-rate submission: ${error.message}` });
    }
};