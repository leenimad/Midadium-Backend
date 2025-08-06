
// backend/controllers/adminController.js
const User = require('../models/UserModel');
const Course = require('../models/courseModel');
const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLogModel'); // <-- Import ActivityLog model when created
const Subject = require('../models/SubjectModel'); // *** IMPORT ***

const Enrollment = require('../models/EnrollmentModel'); // *** IMPORT ***
const StudentProgress = require('../models/StudentProgressModel'); // *** IMPORT
const Lesson = require('../models/LessonModel'); // Import Lesson model
const ProblemReport = require('../models/ProblemReportModel');
const { createChatroomForCourse } = require('../utils/chatroomUtils');
// Helper function for logging (replace with actual implementation)
// IMPORTANT: You need the actor's username. Ensure req.user contains it or fetch it.
const logAdminActivity = async (req, actionType, targetType, targetId, targetName, details) => {
  try {
      // Assuming req.user exists and has id and username (update if needed)
      if (!req.user || !req.user.id || !req.user.username) {
         console.warn("Could not log activity: req.user not properly populated.");
         return;
      }
     await ActivityLog.create({
       actorId: req.user.id,
       actorUsername: req.user.username,
       actionType: actionType,
       targetType: targetType,
       targetId: targetId,
       targetName: targetName,
       details: details
     });
     console.log(`Activity Logged: User ${req.user.username} performed ${actionType} on ${targetType || 'System'}`); // Temporary console log
  } catch (logError) {
     console.error("Failed to log admin activity:", logError);
     // Don't block the main operation if logging fails
  } 
};


// 1. Overview Data
const getOverviewData = async (req, res) => {
  try {
    const totalTeachers = await User.countDocuments({ role: 'teacher' });
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalCourses = await Course.countDocuments();
    // You could add logic to fetch upcoming classes here (requires a schedule model)

    const enrollmentAggregate = await User.aggregate([
      { $match: { role: 'student' } }, // Filter for students
      { $project: { enrollmentsCount: { $size: { "$ifNull": ["$enrollments", []] } } } } ,// Get size of enrollments array
      { $group: { _id: null, totalEnrollments: { $sum: "$enrollmentsCount" } } } // Sum counts
  ]);
  const totalEnrollments = enrollmentAggregate.length > 0 ? enrollmentAggregate[0].totalEnrollments : 0;
  
  // Option B: Fetch all students and sum lengths (Simpler, less efficient for many students)
  // const students = await User.find({ role: 'student' }).select('enrollments').lean();
  // const totalEnrollments = students.reduce((sum, student) => sum + (student.enrollments?.length ?? 0), 0);
  
  res.status(200).json({ totalTeachers, totalStudents, totalCourses, totalEnrollments }); // Add to response
  } catch (error) {
    console.error("Error fetching overview data:", error);
    res.status(500).json({ message: "Failed to fetch overview data" });
  }
};

// 2. Manage Teachers
const getAllTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher' }).select('-password'); // Exclude passwords
    res.status(200).json(teachers);
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({ message: "Failed to fetch teachers" });
  }
};

const getTeacherById = async (req, res) => {
  try {
    const teacherId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({ message: "Invalid Teacher ID format." });
    }

    const teacher = await User.findById(teacherId)
      .select('-password') // Select fields to exclude/include first
      .populate({
          path: 'courses', // Populate the 'courses' array on the User model
          select: 'name description subject price status', // Select desired fields from Course
          populate: { // *** NESTED POPULATE for the 'subject' field WITHIN each course ***
              path: 'subject',
              select: 'name' // Select only the name from the Subject model
          }
      })
      .lean(); // Use lean if you don't need Mongoose documents on backend

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }
    res.status(200).json(teacher);
  } catch (error) {
    console.error("Error fetching teacher by ID:", error);
    res.status(500).json({ message: "Failed to fetch teacher" });
  }
};

const addTeacher = async (req, res) => {
    try {
      const { username, email, password } = req.body;

      // Check if a user with the same email already exists
      let user = await User.findOne({ email });
      if (user) {
          return res.status(400).json({ message: "User already exists" });
      }

      const newTeacher = new User({
        username,
        email,
        password,
        role: 'teacher' // Ensure role is teacher
      });
      await newTeacher.save();

      // Log activity
      await logAdminActivity(req, 'TEACHER_ADDED', 'User', newTeacher._id, newTeacher.username);

      res.status(201).json({ message: "Teacher created", teacher: newTeacher });

    }  catch (error) {
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: messages.join(', ') });
      }
      console.error("Error adding teacher:", error);
      res.status(500).json({ message: "Failed to create teacher" });
    }
  };

  const updateTeacher = async (req, res) => {
    try {
      const { username, email } = req.body;

      const updatedTeacher = await User.findByIdAndUpdate(
        req.params.id,
        { username, email },
        { new: true, runValidators: true }
      ).select('-password');

      if (!updatedTeacher) {
        return res.status(404).json({ message: 'Teacher not found' });
      }

      // Log activity
       await logAdminActivity(req, 'TEACHER_UPDATED', 'User', updatedTeacher._id, updatedTeacher.username);

      res.status(200).json({ message: 'Teacher updated', teacher: updatedTeacher });
    }   catch (error) {
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: messages.join(', ') });
      }
      console.error("Error updating teacher:", error);
      res.status(500).json({ message: 'Failed to update teacher' });
    }
  };

const removeTeacher = async (req, res) => {
    // This function now primarily checks if deletion is allowed
    // The actual deletion happens via removeTeacherAndCourses or removeTeacherKeepCourses
    try {
        const teacherId = req.params.id;
        const teacher = await User.findById(teacherId).populate('courses'); // Populate to get course info for the response

        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        // If the teacher has assigned courses, return error with courses list
        if (teacher.courses && teacher.courses.length > 0) {
             // Ensure courses are returned in a usable format (e.g., array of objects with id and name)
             const courseInfo = teacher.courses.map(course => ({
                 _id: course._id,
                 name: course.name || 'Unknown Course Name' // Handle case where name might be missing
             }));
            return res.status(400).json({
                message: "Teacher has assigned courses. Please confirm deletion or reassign courses.",
                courses: courseInfo // Send structured course info
            });
        }

        // If no assigned courses, proceed with simple deletion
        await User.findByIdAndDelete(teacherId);

        // Log activity
        await logAdminActivity(req, 'TEACHER_REMOVED', 'User', teacherId, teacher.username);

        res.status(200).json({ message: "Teacher removed successfully" });
    } catch (error) {
        console.error("Error in removeTeacher check:", error);
        res.status(500).json({ message: "Failed to remove teacher" });
    }
};

const removeTeacherAndCourses = async (req, res) => {
    // Deletes teacher AND specified courses
    try {
      const teacherId = req.params.id;
      const { coursesToDelete } = req.body;

      if (!Array.isArray(coursesToDelete)) {
          return res.status(400).json({ message: "coursesToDelete must be an array of course IDs" });
      }
      if (!coursesToDelete.every(mongoose.Types.ObjectId.isValid)) {
          return res.status(400).json({ message: "Invalid course ID in coursesToDelete" });
      }

      const teacher = await User.findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ message: "Teacher not found" });
      }

      // Delete the specified courses associated with this teacher
      await Course.deleteMany({ _id: { $in: coursesToDelete }, teacher: teacherId });

      // Remove the teacher
      await User.findByIdAndDelete(teacherId);

      // Log activity
      await logAdminActivity(req, 'TEACHER_REMOVED_WITH_COURSES', 'User', teacherId, teacher.username, { deletedCourses: coursesToDelete.length });

      res.status(200).json({ message: `Teacher and ${coursesToDelete.length} associated course(s) removed` });
    } catch (error) {
      console.error("Error removing teacher and courses:", error);
      res.status(500).json({ message: "Failed to remove teacher and courses" });
    }
  };

const removeTeacherKeepCourses = async (req, res) => {
    // Deletes only the teacher, setting course.teacher to null
    try {
        const teacherId = req.params.id;
        const teacher = await User.findById(teacherId);

        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        const courseIds = teacher.courses || [];
        let orphanedCount = 0;

        if (courseIds.length > 0) {
            const updateResult = await Course.updateMany(
                { _id: { $in: courseIds } },
                { $set: { teacher: null } }
            );
            orphanedCount = updateResult.modifiedCount; // Get count of modified courses
            console.log(`Orphaned ${orphanedCount} courses previously assigned to teacher ${teacherId}`);
        }

        await User.findByIdAndDelete(teacherId);

        // Log activity
        await logAdminActivity(req, 'TEACHER_REMOVED_KEEP_COURSES', 'User', teacherId, teacher.username, { orphanedCourses: orphanedCount });

        res.status(200).json({ message: "Teacher removed successfully, associated courses are now unassigned." });

    } catch (error) {
        console.error("Error removing teacher while keeping courses:", error);
        res.status(500).json({ message: "Failed to remove teacher" });
    }
};


const assignCourseToTeacher = async (req, res) => {
  try {
    const { courseId } = req.body;
    const teacherId = req.params.id; // Teacher ID from URL param
    let courseName = 'Unknown Course'; // For logging

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: 'Invalid course ID' });
    }
    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({ message: 'Invalid teacher ID' });
    }

    // Use Promise.all to fetch concurrently
    const [teacher, course] = await Promise.all([
        User.findById(teacherId),
        Course.findById(courseId).select('name teacher') // Select current teacher too
    ]);

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }
    if (teacher.role !== 'teacher') {
        return res.status(400).json({ message: "Cannot assign course to a non-teacher user" });
    }
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    courseName = course.name; // Get name for logging

    // 1. Assign Course to Teacher's 'courses' array
    if (!teacher.courses.includes(courseId)) {
        teacher.courses.push(courseId);
        await teacher.save(); // Save the teacher document
    } else {
        return res.status(400).json({ message: "Course already assigned to this teacher's list" });
    }

    // 2. Update the 'teacher' field on the Course document
    // Check if it needs updating (and potentially unassign from old teacher)
    const oldTeacherId = course.teacher;
    course.teacher = teacherId; // Assign new teacher ID
    await course.save(); // Save the course document

    // 3. Optional: Unassign from old teacher's 'courses' array
    if (oldTeacherId && oldTeacherId.toString() !== teacherId) {
        await User.findByIdAndUpdate(oldTeacherId, { $pull: { courses: courseId } });
    }

    // Log activity
    await logAdminActivity(req, 'COURSE_ASSIGNED_TEACHER', 'Course', courseId, courseName, { teacherId: teacherId, teacherName: teacher.username });

    // Populate the teacher's courses for the response if needed
    const updatedTeacher = await User.findById(teacherId).populate('courses').select('-password');

    res.status(200).json({ message: "Course assigned to teacher", teacher: updatedTeacher });
  } catch (error) {
    console.error("Error assigning course to teacher:", error);
    res.status(500).json({ message: "Failed to assign course to teacher" });
  }
};


// 3. Manage Courses
const getAllCourses = async (req, res) => {
  try {
    let query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.subjectId) { // Filter by subject ID now
        if (!mongoose.Types.ObjectId.isValid(req.query.subjectId)) { return res.status(400).json({ message: 'Invalid subject ID format.' }); }
        query.subject = req.query.subjectId;
    }
    if (req.query.teacher) {
        // Ensure teacher is a valid ObjectId if provided
         if (!mongoose.Types.ObjectId.isValid(req.query.teacher)) {
             return res.status(400).json({ message: 'Invalid teacher ID for filtering' });
         }
         query.teacher = req.query.teacher;
    }

    const courses = await Course.find(query).populate('teacher', 'username email').populate('subject', 'name') .lean(); // Populate teacher's username/email, use lean
    res.status(200).json(courses);
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({ message: "Failed to fetch courses" });
  }
};
 //////////////////////////////////////// get course by id /////////////
const getCourseById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { return res.status(400).json({ message: 'Invalid Course ID format.' }); }
    const course = await Course.findById(req.params.id)
                                 .populate('teacher', 'username email')
                                 .populate('subject', 'name') // Populate subject name
                                 // Do NOT populate students here for admin view unless needed
                                 .lean();
    if (!course) { return res.status(404).json({ message: "Course not found" }); }
    
    res.status(200).json(course);
  } catch (error) {
    console.error("Error fetching course by ID:", error);
    res.status(500).json({ message: "Failed to fetch course" });
  }
};
////////////// approve course ////////////
const approveCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true }).populate('subject','name');
    if (!course) { return res.status(404).json({ message: "Course not found" }); }
    await logAdminActivity(req, 'COURSE_APPROVED', 'Course', course._id, course.name);
    res.status(200).json({ message: "Course approved", course });
  } catch (error) {
    console.error("Error approving course:", error);
    res.status(500).json({ message: "Failed to approve course" });
  }
};

const rejectCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Log activity
     await logAdminActivity(req, 'COURSE_REJECTED', 'Course', course._id, course.name);

    res.status(200).json({ message: "Course rejected", course });
  } catch (error) {
    console.error("Error rejecting course:", error);
    res.status(500).json({ message: "Failed to reject course" });
  }
};
//////////////////////////// update Course //////////////////
const updateCourse = async (req, res) => {
  try {
    const courseId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(courseId)) { return res.status(400).json({ message: 'Invalid Course ID format.' }); }

   // *** REMOVED grade, ADDED subjectId, price ***
   const { name, description, subjectId, syllabus, resources, teacher, price } = req.body;
    // Allow teachers to update their own courses, admins can update any
    const courseToUpdate = await Course.findById(courseId);
    if (!courseToUpdate) { return res.status(404).json({ message: 'Course not found.' }); }
    
        // Authorization check: Only admin or the course's original teacher can update
        if (req.user.role !== 'admin' && courseToUpdate.teacher.toString() !== req.user.id) {
          return res.status(403).json({ message: 'Forbidden: You cannot update this course.' });
      }

     let teacherName = null; // For logging

     const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (syllabus !== undefined) updateData.syllabus = syllabus.trim();
        if (resources !== undefined) updateData.resources = resources.trim();
         if (price !== undefined && price !== null) {
            if (typeof price !== 'number' || price < 0) return res.status(400).json({ message: 'Invalid price.' });
            updateData.price = price;
         }

         // Validate Subject ID if provided
         if (subjectId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(subjectId)) return res.status(400).json({ message: 'Invalid Subject ID.' });
            const subjectExists = await Subject.findById(subjectId).lean();
            if (!subjectExists) return res.status(400).json({ message: 'Selected subject not found.' });
            updateData.subject = subjectId;
         }

         // Validate and Handle Teacher Reassignment (Only Admin Should Do This?)
         // Decide if teachers can reassign their own courses - typically NO.
         if (teacher !== undefined && req.user.role === 'admin') { // Only allow admin to change teacher
             if (!mongoose.Types.ObjectId.isValid(teacher)) return res.status(400).json({ message: 'Invalid Teacher ID.' });
             const teacherUser = await User.findById(teacher).select('username role').lean();
             if (!teacherUser || teacherUser.role !== 'teacher') return res.status(400).json({ message: 'New teacher not found or is not a teacher.' });
             updateData.teacher = teacher;
             teacherName = teacherUser.username; // For logging
         } else if (teacher !== undefined && req.user.role !== 'admin') {
              console.warn(`Teacher ${req.user.id} attempted to reassign course ${courseId}. Blocked.`);
              // Silently ignore or return error
              // return res.status(403).json({ message: 'Only admins can reassign courses to different teachers.' });
         }


         // --- Perform Update ---
         const updatedCourse = await Course.findByIdAndUpdate( courseId, updateData, { new: true, runValidators: true } )
                                            .populate('teacher', 'username email')
                                            .populate('subject', 'name'); // Populate new subject field

         if (!updatedCourse) { return res.status(404).json({ message: 'Course not found after update attempt.' }); }

         // --- Handle Teacher's Course List (if teacher changed by admin) ---
         if (teacher !== undefined && req.user.role === 'admin' && courseToUpdate.teacher.toString() !== updatedCourse.teacher._id.toString()) {
             // Remove from old teacher
             await User.findByIdAndUpdate(courseToUpdate.teacher, { $pull: { courses: courseId } });
             // Add to new teacher
             await User.findByIdAndUpdate(updatedCourse.teacher._id, { $addToSet: { courses: courseId } });
         }

         // Log activity
         await logAdminActivity(req, 'COURSE_UPDATED', 'Course', updatedCourse._id, updatedCourse.name, { teacherAssigned: updatedCourse.teacher.username, subject: updatedCourse.subject.name });

         res.status(200).json({ message: 'Course updated', course: updatedCourse });
    } catch (error) {
        if (error.name === 'ValidationError') { return res.status(400).json({ message: Object.values(error.errors).map(e => e.message).join(', ') }); }
        console.error("Update Course Error:", error);
        res.status(500).json({ message: 'Failed to update course' });
    }
};
////////////////////////// add course //////////////
const addCourse = async (req, res) => {
  try {
    const {  name, description, subjectId, syllabus, resources, price } = req.body;
    const actorId = req.user.id;
    const actorUsername = req.user.username;
    const actorRole = req.user.role;
    let courseTeacherId;
    let courseTeacherUsername = 'Unknown';
    if (actorRole === 'teacher') {
      courseTeacherId = actorId; // Teacher creates course for themselves
      courseTeacherUsername = actorUsername;
  } else if (actorRole === 'admin') {
    
      // If admin is creating, they MUST provide the intended teacher's ID
       if (!req.body.teacher || !mongoose.Types.ObjectId.isValid(req.body.teacher)) {
           return res.status(400).json({ message: 'Admin must specify a valid Teacher ID when creating a course.' });
       }
       const assignedTeacher = await User.findById(req.body.teacher).select('username role').lean();
       if (!assignedTeacher || assignedTeacher.role !== 'teacher') {
           return res.status(400).json({ message: 'Specified teacher not found or is not a teacher.' });
       }
       courseTeacherId = req.body.teacher;
       courseTeacherUsername = assignedTeacher.username;

  } else {
      // Should not happen if authorizeRoles middleware is used correctly
      return res.status(403).json({ message: 'Forbidden: Only Teachers or Admins can create courses.' });
  }

     // Validate required fields
     if (!name || !description || !subjectId || price === undefined || price === null) {
      return res.status(400).json({ message: 'Missing required fields: name, description, subjectId, price.' });
 }

   // Validate IDs
   if (!mongoose.Types.ObjectId.isValid(courseTeacherId) || !mongoose.Types.ObjectId.isValid(subjectId)) {
    return res.status(400).json({ message: 'Invalid teacher or subject ID.' });
}

if (!mongoose.Types.ObjectId.isValid(subjectId)) {
  return res.status(400).json({ message: 'Invalid Subject ID format.' });
}
if (typeof price !== 'number' || price < 0) {
  return res.status(400).json({ message: 'Invalid price. Must be a non-negative number.' });
}

// Check if teacher & subject exist and teacher is valid role
const [teacherUser, subjectExists] = await Promise.all([
     User.findById(courseTeacherId).select('username role').lean(),
     Subject.findById(subjectId).lean()
 ]);

if (!teacherUser || teacherUser.role !== 'teacher') {
    return res.status(400).json({ message: 'Assigned teacher not found or is not a teacher.' });
}
if (!subjectExists) {
     return res.status(400).json({ message: 'Selected subject not found.' });
}
courseTeacherUsername = teacherUser.username;

const newCourse = new Course({
  name: name.trim(),
   description: description.trim(), 
   teacher: courseTeacherId,
  subject: subjectId, // *** Use subjectId ***
  syllabus: syllabus?.trim(), resources: resources?.trim(), status: 'pending', // default status
  price: price // Add price
});
await newCourse.save();

    // Update the teacher's courses array
    await User.findByIdAndUpdate(courseTeacherId, { $addToSet: { courses: newCourse._id } });

   // CREATE CHATROOM IN FIRESTORE 
    if (newCourse._id && courseTeacherId && newCourse.name) {
       await createChatroomForCourse(newCourse._id, courseTeacherId, newCourse.name);
    }
    // END CREATE CHATROOM 


    // Log activity
    await logAdminActivity(req, 'COURSE_ADDED', 'Course', newCourse._id, newCourse.name, { teacherAssigned: courseTeacherUsername , subjectId: subjectId,
      subjectName: subjectExists.name});

    res.status(201).json({ message: "Course created and pending approval.", course: newCourse });
  } catch (error) {
     if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    console.error("Error adding course:", error);
    res.status(500).json({ message: "Failed to create course" });
  }
};
/////////////////// remove course ////////////////
const removeCourse = async (req, res) => { // Create or adapt a delete function
  try {
    const courseId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid course ID" });
    }
        // *** STEP 1: Check for Active Enrollments ***
        const activeEnrollmentCount = await Enrollment.countDocuments({ course: courseId });

        if (activeEnrollmentCount > 0) {
            // If enrollments exist, block deletion and inform the admin
            return res.status(400).json({
                message: `Cannot delete course. ${activeEnrollmentCount} student(s) are actively enrolled. Please unenroll students first.`
            });
        }
        // *** END ENROLLMENT CHECK ***

        // --- If no active enrollments, proceed with deletion ---
        console.log(`No active enrollments found for course ${courseId}. Proceeding with deletion.`);

        // Find the course to get its details for cleanup and logging *before* deleting
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Use findByIdAndDelete which returns the deleted document
        await Course.findByIdAndDelete(courseId);
        console.log(`Course document ${courseId} deleted.`);

        // --- Cleanup Associated Data ---

        // Remove from teacher's 'courses' list
        if (course.teacher) {
            await User.findByIdAndUpdate(course.teacher, { $pull: { courses: courseId } });
            console.log(`Removed course ${courseId} from teacher ${course.teacher}'s list.`);
        }

        // Delete any pending/rejected Enrollment Requests for this course
        const deletedRequests = await Enrollment.deleteMany({ course: courseId });
        if (deletedRequests.deletedCount > 0) {
            console.log(`Deleted ${deletedRequests.deletedCount} enrollment requests for course ${courseId}.`);
        }

        // Find Lesson IDs associated with the course BEFORE deleting lessons
        const lessonIds = await Lesson.find({ course: courseId }).select('_id').lean();
        const lessonIdArray = lessonIds.map(l => l._id);

        // Delete associated Lessons
        if (lessonIdArray.length > 0) {
            const deletedLessons = await Lesson.deleteMany({ _id: { $in: lessonIdArray } });
            if (deletedLessons.deletedCount > 0) {
                console.log(`Deleted ${deletedLessons.deletedCount} lessons for course ${courseId}.`);

                // Delete GeneratedContent linked to the deleted lessons
                const deletedGenContent = await GeneratedContent.deleteMany({ lesson: { $in: lessonIdArray } });
                if (deletedGenContent.deletedCount > 0) {
                    console.log(`Deleted ${deletedGenContent.deletedCount} generated content items.`);
                }
            }
        }

        // --- Log Activity ---
        await logAdminActivity(req, 'COURSE_REMOVED', 'Course', courseId, course.name);

        res.status(200).json({ message: 'Course deleted successfully' });

    } catch (error) {
        console.error("Error deleting course:", error);
        res.status(500).json({ message: "Failed to delete course" });
    }
};

// --- NEW: Manage Students ---

// const getAllStudents = async (req, res) => {
//   try {
//     // Filter by grade if provided
//     let query = { role: 'student' };
//     if (req.query.grade) {
//       query.grade = req.query.grade;
//     }
//     // Add search query for name/email
//      if (req.query.search) {
//          const searchQuery = new RegExp(req.query.search, 'i'); // Case-insensitive search
//          query.$or = [
//             { username: searchQuery },
//             { email: searchQuery }
//          ];
//      }

//     const students = await User.find(query)
//         .select('-password -resetCode -resetCodeExpires') // Exclude sensitive info
//         // .populate('enrollments', 'name subject') // Optionally populate basic course info
//         .sort({ username: 1 }) // Sort alphabetically by username
//         .lean();
//     res.status(200).json(students);
//   } catch (error) {
//     console.error("Error fetching students:", error);
//     res.status(500).json({ message: "Failed to fetch students" });
//   }
// };
const getAllStudents = async (req, res) => {
  try {
    // *** FIX: Initialize query object ***
    let query = { role: 'student' }; // Initialize base query for students

    // Add search query for name/email
     if (req.query.search) {
         const searchQuery = new RegExp(req.query.search, 'i');
         // Add the $or condition correctly to the existing query object
         query.$or = [
            { username: searchQuery },
            { email: searchQuery }
         ];
     }

    // Remove populate logic if not needed for admin list view
    const students = await User.find(query) // Pass the query object
        .select('username email role createdAt updatedAt') // Select relevant fields
        .sort({ username: 1 }) 
        .lean();

    res.status(200).json(students);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ message: "Failed to fetch students" });
  }
};

const getStudentById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid student ID" });
    }

    // Check if populate is requested
   const shouldPopulate = req.query.populate === 'enrollments';
     let studentQuery = User.findOne({ _id: req.params.id, role: 'student' })
                            // *** REMOVED grade from select ***
                           .select('username email role enrollments createdAt updatedAt');

      if (shouldPopulate) {
          studentQuery = studentQuery.populate({
              path: 'enrollments', // Assuming this refers to the Enrollment model now via virtuals or separate query
              select: 'course enrolledAt', // Example fields from Enrollment model
              populate: { // Nested populate for course details within enrollment
                  path: 'course',
                  select: 'name subject status teacher',
                  populate: { path: 'teacher subject', select: 'username name' } // Populate teacher/subject names
              }
          });
      }


    const student = await studentQuery.lean();

    if (!student) { return res.status(404).json({ message: "Student not found" }); }
    res.status(200).json(student);
  } catch (error) {
    console.error("Error fetching student by ID:", error);
    res.status(500).json({ message: "Failed to fetch student" });
  }
};
const addStudent = async (req, res) => {
    try {
      // Include grade in destructuring
      const { username, email, password} = req.body;

      

      // Check if a user with the same email already exists
      let user = await User.findOne({ email });
      if (user) {
          return res.status(400).json({ message: "User already exists with this email" });
      }

      const newStudent = new User({
        username,
        email,
        password,
        role: 'student', // Ensure role is student
       // grade: grade,      // Assign grade
        enrollments: []    // Initialize enrollments array
      });
      await newStudent.save();

      // Log activity
      await logAdminActivity(req, 'STUDENT_ADDED', 'User', newStudent._id, newStudent.username, { grade: newStudent.grade });

      // Return lean object without sensitive info
      const studentResponse = {
         _id: newStudent._id,
         username: newStudent.username,
         email: newStudent.email,
         role: newStudent.role,
        
         enrollments: newStudent.enrollments,
         createdAt: newStudent.createdAt,
         updatedAt: newStudent.updatedAt
      };

      res.status(201).json({ message: "Student created", student: studentResponse });

    } catch (error) {
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: messages.join(', ') });
      }
      console.error("Error adding student:", error);
      res.status(500).json({ message: "Failed to create student" });
    }
};

const updateStudent = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid student ID" });
        }

        const { username, email } = req.body;

        // Basic validation for presence
        if (!username && !email && !grade) {
           return res.status(400).json({ message: "No update fields provided." });
        }

        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (email !== undefined) updateData.email = email;
        

         // Prevent accidental role change
        if (req.body.role) {
          console.warn("Attempt to change student role via updateStudent endpoint blocked.");
           // Optionally return an error:
           // return res.status(400).json({ message: "Cannot change user role via this endpoint." });
        }

        // Validate email uniqueness if changed
         if (email) {
           const existingUser = await User.findOne({ email: email, _id: { $ne: req.params.id } });
           if (existingUser) {
             return res.status(400).json({ message: "Email already in use by another account." });
           }
         }

        const updatedStudent = await User.findOneAndUpdate(
            { _id: req.params.id, role: 'student' }, // Ensure we only update students
            updateData,
            { new: true, runValidators: true }
        ).select('-password -resetCode -resetCodeExpires -grade'); // Exclude sensitive info

        if (!updatedStudent) {
            return res.status(404).json({ message: 'Student not found or user is not a student' });
        }

        // Log activity
        await logAdminActivity(req, 'STUDENT_UPDATED', 'User', updatedStudent._id, updatedStudent.username, updateData);

        res.status(200).json({ message: 'Student updated', student: updatedStudent });
    } catch (error) {
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        console.error("Error updating student:", error);
        res.status(500).json({ message: 'Failed to update student' });
    }
};

const removeStudent = async (req, res) => {
  try {
    const studentId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(studentId)) { return res.status(400).json({ message: "Invalid student ID" }); }

   // Find student first to log username before deleting
   const student = await User.findOne({ _id: studentId, role: 'student' });
   if (!student) { return res.status(404).json({ message: "Student not found or user is not a student" }); }

   // --- Cleanup related data BEFORE deleting the user ---

   // 1. Delete active Enrollments for this student
   const deletedEnrollments = await Enrollment.deleteMany({ student: studentId });
   if (deletedEnrollments.deletedCount > 0) {
       console.log(`Deleted ${deletedEnrollments.deletedCount} active enrollments for student ${studentId}.`);
   }

   // 2. Delete pending/rejected Enrollment Requests for this student
   const deletedRequests = await Enrollment.deleteMany({ student: studentId });
    if (deletedRequests.deletedCount > 0) {
       console.log(`Deleted ${deletedRequests.deletedCount} enrollment requests for student ${studentId}.`);
   }

   // 3. Remove student from the 'students' array in any Courses they were enrolled in
   // (This step is redundant if we delete Enrollment documents, but can be kept as safety)
   // This requires knowing which courses they *were* enrolled in before deleting Enrollments.
   // It's simpler to rely on the Enrollment document deletion.
   // await Course.updateMany(
   //     { students: studentId }, // Find courses where student is listed
   //     { $pull: { students: studentId } }
   // );

   // --- Now delete the student ---
   await User.findByIdAndDelete(studentId);

   // Log activity
   await logAdminActivity(req, 'STUDENT_REMOVED', 'User', studentId, student.username);

   res.status(200).json({ message: "Student and associated enrollments/requests removed successfully" });
} catch (error) {
   console.error("Error removing student:", error);
   res.status(500).json({ message: "Failed to remove student" });
}
};

// *** NEW FUNCTION: Admin gets enrollments for a SPECIFIC student ***
const getEnrollmentsForStudent = async (req, res) => {
  try {
      const { studentId } = req.params; // Get student ID from route parameter

      if (!mongoose.Types.ObjectId.isValid(studentId)) {
          return res.status(400).json({ message: 'Invalid Student ID format.' });
      }

      // Optional: Verify the studentId actually corresponds to a user with role 'student'
      const studentExists = await User.countDocuments({ _id: studentId, role: 'student' });
      if (studentExists === 0) {
          return res.status(404).json({ message: 'Student not found.' });
      }

      // Find active enrollments for the specified student
      const enrollments = await Enrollment.find({ student: studentId })
          .populate({
              path: 'course', // Populate course details
              // Match: { status: 'approved' }, // Maybe admin wants to see enrollments even if course later becomes pending/rejected? Decide this. Let's show all for now.
              select: 'name subject status teacher price', // Fields admin might want to see
              populate: [
                  { path: 'teacher', select: 'username' },
                  { path: 'subject', select: 'name' }
              ]
          })
          .sort({ enrolledAt: -1 }) // Sort by enrollment date
          .lean();

      // No need to filter by course status here unless required by admin view

      res.status(200).json(enrollments); // Return the list of enrollment documents

  } catch (error) {
      console.error(`Error fetching enrollments for student ${req.params.studentId} by admin:`, error);
      res.status(500).json({ message: 'Failed to fetch student enrollments.' });
  }
};

//////////////////////////////////////////////////////////

// 4. Reports
const getReports = async (req, res) => {
  try {
const [
  courses,
  teachers,
  studentCount,
  // *** NEW: Fetch required progress data ***
  totalEnrollmentsCount, // Count active enrollments
  allProgressRecords, // Fetch ALL progress records for calculations
  totalProblemReports,
  newProblemReportsCount // Optional: Count of new reports
] = await Promise.all([
  Course.find({}).populate('subject', 'name').lean(),
  User.find({ role: 'teacher' }).select('username courses').lean(),
  User.countDocuments({ role: 'student' }),
  Enrollment.countDocuments({}), // Count total active enrollments
  StudentProgress.find({}).select('student course lesson status').lean(), // Select fields needed for aggregation
  ProblemReport.countDocuments({}), // *** Get total problem reports ***
            ProblemReport.countDocuments({ status: 'new' }) // *** Get count of new reports ***
]);

// --- Course Status Breakdown ---
const statusCounts = { pending: 0, approved: 0, rejected: 0, total: courses.length };
courses.forEach(c => { if (statusCounts.hasOwnProperty(c.status)) statusCounts[c.status]++; });

// --- Courses per Subject ---
const coursesPerSubject = {};
courses.forEach(c => { coursesPerSubject[c.subject?.name ?? 'Uncategorized'] = (coursesPerSubject[c.subject?.name ?? 'Uncategorized'] || 0) + 1; });
const subjectDistribution = Object.entries(coursesPerSubject).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

// --- Courses per Teacher ---
const coursesPerTeacher = teachers.map(t => ({ name: t.username, count: t.courses?.length ?? 0 })).sort((a, b) => b.count - a.count);

// --- Student Count ---
const totalStudents = studentCount;

// --- *** Real Progress Aggregation *** ---

let totalCompletedLessons = 0;
let totalLessonsWithProgress = 0; // Count lessons students have started
const lessonsCompletedPerStudent = {}; // { studentId: count }

allProgressRecords.forEach(p => {
  totalLessonsWithProgress++; // Count any interaction
  if (p.status === 'completed') {
      totalCompletedLessons++;
      const studentIdStr = p.student.toString();
      lessonsCompletedPerStudent[studentIdStr] = (lessonsCompletedPerStudent[studentIdStr] || 0) + 1;
  }
});
   
// Calculate Average Lessons Completed per Student (who has started at least one lesson)
const studentsWithProgress = Object.keys(lessonsCompletedPerStudent).length;
const averageLessonsCompleted = studentsWithProgress > 0
  ? Math.round(totalCompletedLessons / studentsWithProgress) // Average among active students
  : 0;

// Calculate Overall Platform Completion Rate (Completed Lessons / Total Lessons in *Approved* Courses)
// This requires fetching the total number of lessons in *approved* courses
const approvedCourses = courses.filter(c => c.status === 'approved');
const approvedCourseIds = approvedCourses.map(c => c._id);
const totalLessonsInApprovedCourses = await Lesson.countDocuments({ course: { $in: approvedCourseIds } });

const overallCompletionRate = totalLessonsInApprovedCourses > 0
  ? (totalCompletedLessons / totalLessonsInApprovedCourses)
  : 0;

console.log("Progress Calculation:", {
  totalCompletedLessons, totalLessonsWithProgress, studentsWithProgress, averageLessonsCompleted, totalLessonsInApprovedCourses, overallCompletionRate
});

// --- Assemble the FINAL Report Data ---
const reportData = {
  courseStatusCounts: statusCounts,
  subjectDistribution: subjectDistribution,
  coursesPerTeacher: coursesPerTeacher,
  totalStudents: totalStudents,
  totalEnrollments: totalEnrollmentsCount, // Add total enrollments count
  // Use real calculated values, replace placeholders
  overallCompletionRate: overallCompletionRate,         // Use calculated rate
  averageLessonsCompleted: averageLessonsCompleted, // Use calculated average
  totalProblemReports, // *** Add this to response ***
  newProblemReportsCount,
};

res.status(200).json(reportData);

} catch (error) {
console.error("Error generating reports:", error);
res.status(500).json({ message: "Failed to generate reports" });
}
};

// 5. Settings (Admin Profile)
const getAdminSettings = async (req, res) => {
  try {
    // Assuming req.user has id (from protect middleware)
    const admin = await User.findById(req.user.id).select('-password');
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.status(200).json(admin);
  } catch (error) {
    console.error("Error fetching admin settings:", error);
    res.status(500).json({ message: "Failed to fetch admin settings" });
  }
};

const updateAdminSettings = async (req, res) => {
  try {
    const { username, email } = req.body;
    const adminId = req.user.id;

    // Check if email is being changed and if it already exists for another user
     if (email) {
       const existingUser = await User.findOne({ email: email, _id: { $ne: adminId } });
       if (existingUser) {
         return res.status(400).json({ message: "Email already in use by another account." });
       }
     }

    const updatedAdmin = await User.findByIdAndUpdate(
      adminId,
      { username, email }, // Only update these fields
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Log activity (Example - adjust as needed)
     await logAdminActivity(req, 'ADMIN_SETTINGS_UPDATED', 'User', updatedAdmin._id, updatedAdmin.username);


    res.status(200).json({ message: "Admin settings updated", admin: updatedAdmin });
  } catch (error) {
     if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    console.error("Error updating admin settings:", error);
    res.status(500).json({ message: "Failed to update admin settings" });
  }
};

// 6. Activity Log (Add this function)
const getActivityLog = async (req, res) => {
  try {
      const limit = parseInt(req.query.limit) || 15;
      const logs = await ActivityLog.find() // <-- Use the actual model
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();
      res.status(200).json(logs);
  } catch (error) {
      console.error("Error fetching activity log:", error);
      res.status(500).json({ message: "Failed to fetch activity log" });
  }
};
const enrollStudentInCourse = async (req, res) => {
  try {
      const { studentId, courseId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({ message: 'Invalid Student or Course ID' });
      }

      // Use Promise.all for concurrent checks/fetches
      const [student, course] = await Promise.all([
          User.findOne({ _id: studentId, role: 'student' }).lean(), // Ensure it's a student
          Course.findById(courseId).select('name').lean() // Check course exists
      ]);

      if (!student) return res.status(404).json({ message: 'Student not found' });
      if (!course) return res.status(404).json({ message: 'Course not found' });

      // Use findOneAndUpdate with upsert to create enrollment if it doesn't exist
      const enrollment = await Enrollment.findOneAndUpdate(
          { student: studentId, course: courseId },
          { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
          { new: true, upsert: true, runValidators: true }
      );

      // Log activity
      await logAdminActivity(req, 'STUDENT_ENROLLED', 'User', studentId, student.username, { courseId: courseId, courseName: course.name, method: 'Admin Override' });

      res.status(200).json({ message: 'Student manually enrolled successfully', enrollment });

  } catch (error) {
      console.error('Error during admin enrollment:', error);
      res.status(500).json({ message: 'Failed to enroll student' });
  }
};

// Admin Manually Unenrolls a Student
const unenrollStudentFromCourse = async (req, res) => {
  try {
      const { studentId, courseId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({ message: 'Invalid Student or Course ID' });
      }

      // Find and delete the specific enrollment document
      const deletedEnrollment = await Enrollment.findOneAndDelete({
          student: studentId,
          course: courseId
      });

      if (!deletedEnrollment) {
          return res.status(404).json({ message: 'Enrollment record not found. Student might not be enrolled in this course.' });
      }

      // Log activity (fetch names if needed, or use IDs)
      // const student = await User.findById(studentId).select('username').lean();
      // const course = await Course.findById(courseId).select('name').lean();
      await logAdminActivity(req, 'STUDENT_UNENROLLED', 'User', studentId, 'N/A', { courseId: courseId, method: 'Admin Override' });

      res.status(200).json({ message: 'Student manually unenrolled successfully' });

  } catch (error) {
      console.error('Error during admin unenrollment:', error);
      res.status(500).json({ message: 'Failed to unenroll student' });
  }
};
///////////////////////////

const getCourseEnrollments = async (req, res) => {
  try {
      const { courseId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({ message: 'Invalid Course ID format.' });
      }

      // Find enrollments for the course and populate student details
      const enrollments = await Enrollment.find({ course: courseId })
          .populate({
              path: 'student', // Populate the student field in Enrollment
              select: 'username email' // Select desired student fields
          })
          .select('student course enrolledAt createdAt updatedAt') // Select Enrollment fields
          .sort({ enrolledAt: -1 }) // Sort by enrollment date
          .lean();

      if (!enrollments) {
          // This case might not be hit often if find returns [], but good practice
          return res.status(404).json({ message: 'No enrollments found for this course.' });
      }

      res.status(200).json(enrollments); // Return the list of enrollments (with populated students)

  } catch (error) {
      console.error(`Error fetching enrollments for course ${req.params.courseId}:`, error);
      res.status(500).json({ message: 'Failed to fetch course enrollments.' });
  }
};
//////////////////////////////////////////////////////////////////////
// Approve Course
exports.approveCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Find the course by ID and change status to 'approved'
    const course = await Course.findByIdAndUpdate(
      courseId,
      { status: 'approved' },
      { new: true }
    );

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.status(200).json({ message: 'Course approved', course });
  } catch (error) {
    console.error('Error approving course:', error);
    res.status(500).json({ message: 'Failed to approve course' });
  }
};

// Reject Course
exports.rejectCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Find and delete the course
    const course = await Course.findByIdAndDelete(courseId);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.status(200).json({ message: 'Course rejected and deleted', course });
  } catch (error) {
    console.error('Error rejecting course:', error);
    res.status(500).json({ message: 'Failed to reject course' });
  }
};


// --- EXPORTS ---
module.exports = {
  // Overview
  getOverviewData,
  // Teachers
  getAllTeachers,
  getTeacherById,
  addTeacher,
  updateTeacher,
  removeTeacher, // Checks if teacher has courses
  removeTeacherAndCourses, // Deletes teacher AND specified courses
  removeTeacherKeepCourses, // Deletes teacher, orphans courses
  assignCourseToTeacher,
    // Students 
    getAllStudents,
    getStudentById,
    addStudent,
    updateStudent,
    removeStudent,
    enrollStudentInCourse,   
    unenrollStudentFromCourse, 
  // Courses
  getAllCourses,
  getCourseById,
  approveCourse,
  rejectCourse,
  updateCourse,
  addCourse,
  removeCourse,
  // Reports
  getReports,
  // Settings
  getAdminSettings,
  updateAdminSettings,
  // Activity Log
  getActivityLog,
getCourseEnrollments,
getEnrollmentsForStudent
};