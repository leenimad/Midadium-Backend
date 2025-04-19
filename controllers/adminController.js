
// backend/controllers/adminController.js
const User = require('../models/UserModel');
const Course = require('../models/courseModel');
const mongoose = require('mongoose');
 const ActivityLog = require('../models/ActivityLogModel'); // <-- Import ActivityLog model when created
 

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
    const teacher = await User.findById(req.params.id).populate('courses').select('-password'); // Populate assigned courses
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
    if (req.query.subject) query.subject = req.query.subject;
    if (req.query.grade) query.grade = req.query.grade;
    if (req.query.teacher) {
        // Ensure teacher is a valid ObjectId if provided
         if (!mongoose.Types.ObjectId.isValid(req.query.teacher)) {
             return res.status(400).json({ message: 'Invalid teacher ID for filtering' });
         }
         query.teacher = req.query.teacher;
    }

    const courses = await Course.find(query).populate('teacher', 'username email').lean(); // Populate teacher's username/email, use lean
    res.status(200).json(courses);
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({ message: "Failed to fetch courses" });
  }
};
 
const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
    .populate('teacher', 'username email') // Keep teacher populate
    .populate('students', 'username email grade') // <-- ADD THIS POPULATE
    .lean();
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    console.error("Error fetching course by ID:", error);
    res.status(500).json({ message: "Failed to fetch course" });
  }
};

const approveCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Log activity
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

const updateCourse = async (req, res) => {
  try {
    const { name, description, subject, grade, syllabus, resources, teacher } = req.body;
    const courseId = req.params.id;
    let teacherName = null; // For logging

    // Validate incoming data
    if (teacher && !mongoose.Types.ObjectId.isValid(teacher)) {
        return res.status(400).json({ message: 'Invalid Teacher ID provided for update' });
    }
    // Optionally check if teacher exists and is actually a teacher
    if (teacher) {
        const teacherUser = await User.findById(teacher).select('username role');
        if (!teacherUser || teacherUser.role !== 'teacher') {
             return res.status(400).json({ message: 'Assigned teacher not found or is not a teacher' });
        }
        teacherName = teacherUser.username; // Get name for logging
    }


    // Prepare update data, only including fields provided
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (subject !== undefined) updateData.subject = subject;
    if (grade !== undefined) updateData.grade = grade;
    if (syllabus !== undefined) updateData.syllabus = syllabus;
    if (resources !== undefined) updateData.resources = resources;
    if (teacher !== undefined) updateData.teacher = teacher; // Can be null to unassign

    // Fetch the course before update to handle teacher assignments later
    const courseBeforeUpdate = await Course.findById(courseId);
     if (!courseBeforeUpdate) {
      return res.status(404).json({ message: "Course not found" });
    }


    // Perform the update
    const updatedCourse = await Course.findByIdAndUpdate(
      courseId,
      updateData,
      { new: true, runValidators: true }
    ).populate('teacher', 'username email'); // Keep populate

    if (!updatedCourse) {
      // Should not happen if courseBeforeUpdate was found, but safety check
      return res.status(404).json({ message: "Course not found after update attempt" });
    }

    // Handle Teacher Course List Updates (if teacher changed)
    const oldTeacherId = courseBeforeUpdate.teacher;
    const newTeacherId = updatedCourse.teacher ? updatedCourse.teacher._id : null; // Updated teacher ID (could be null)

    if ((oldTeacherId?.toString() ?? null) !== (newTeacherId?.toString() ?? null)) {
        // Remove from old teacher's list if they existed
        if (oldTeacherId) {
            await User.findByIdAndUpdate(oldTeacherId, { $pull: { courses: courseId } });
        }
        // Add to new teacher's list if assigned
        if (newTeacherId) {
            await User.findByIdAndUpdate(newTeacherId, { $addToSet: { courses: courseId } });
        }
    }

    // Log activity
    await logAdminActivity(req, 'COURSE_UPDATED', 'Course', updatedCourse._id, updatedCourse.name, { teacherAssigned: teacherName });

    res.status(200).json({ message: "Course updated", course: updatedCourse });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    console.error("Update Course Error:", error);
    res.status(500).json({ message: "Failed to update course" });
  }
};

const addCourse = async (req, res) => {
  try {
    const { name, description, teacher, subject, grade, syllabus, resources } = req.body;
    let teacherUsername = 'Unknown'; // For logging

    if (!mongoose.Types.ObjectId.isValid(teacher)) {
        return res.status(400).json({ message: 'Invalid teacher ID' });
    }
    // Check if teacher exists and is a teacher
     const teacherUser = await User.findById(teacher).select('username role');
     if (!teacherUser || teacherUser.role !== 'teacher') {
         return res.status(400).json({ message: 'Assigned teacher not found or is not a teacher' });
     }
     teacherUsername = teacherUser.username;

    const newCourse = new Course({
      name, description, teacher, subject, grade, syllabus, resources
    });
    await newCourse.save();

    // Update the teacher's courses array
    await User.findByIdAndUpdate(teacher, { $addToSet: { courses: newCourse._id } });

    // Log activity
    await logAdminActivity(req, 'COURSE_ADDED', 'Course', newCourse._id, newCourse.name, { teacherAssigned: teacherUsername });

    res.status(201).json({ message: "Course created", course: newCourse });
  } catch (error) {
     if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    console.error("Error adding course:", error);
    res.status(500).json({ message: "Failed to create course" });
  }
};

const removeCourse = async (req, res) => { // Create or adapt a delete function
  try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
           return res.status(400).json({ message: "Invalid course ID" });
       }
     const courseId = req.params.id;
     const course = await Course.findByIdAndDelete(courseId);

     if (!course) {
        return res.status(404).json({ message: 'Course not found' });
     }

     // Remove course from teacher's list
      if (course.teacher) {
        await User.findByIdAndUpdate(course.teacher, { $pull: { courses: courseId } });
      }

     // Remove course from all enrolled students' lists
     if (course.students && course.students.length > 0) {
        await User.updateMany(
            { _id: { $in: course.students } },
            { $pull: { enrollments: courseId } }
        );
        console.log(`Removed course ${courseId} from ${course.students.length} student enrollment lists.`);
     }


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
    // Filter by grade if provided
    let query = { role: 'student' };
    if (req.query.grade) {
      query.grade = req.query.grade;
    }
    // Add search query for name/email
    if (req.query.search) {
      const searchQuery = new RegExp(req.query.search, 'i');
      query.$or = [
        { username: searchQuery },
        { email: searchQuery }
      ];
    }

    // Check if populate is requested
    const shouldPopulate = req.query.populate === 'enrollments';
    
    let studentsQuery = User.find(query)
      .select('-password -resetCode -resetCodeExpires')
      .sort({ username: 1 });

    if (shouldPopulate) {
      studentsQuery = studentsQuery.populate({
        path: 'enrollments',
        select: 'name subject status teacher', // Only include these fields
        populate: {
          path: 'teacher',
          select: 'username' // Only include teacher's username
        }
      });
    }

    const students = await studentsQuery.lean();
    res.status(200).json(students);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ message: "Failed to fetch students" });
  }
};
// const getStudentById = async (req, res) => {
//   try {
//      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//         return res.status(400).json({ message: "Invalid student ID" });
//      }
//     const student = await User.findOne({ _id: req.params.id, role: 'student' })
//                                 .select('-password -resetCode -resetCodeExpires')
//                                 .populate('enrollments', 'name subject status teacher') // Populate more course details
//                                 .lean();
//     if (!student) {
//       return res.status(404).json({ message: "Student not found" });
//     }
//     res.status(200).json(student);
//   } catch (error) {
//     console.error("Error fetching student by ID:", error);
//     res.status(500).json({ message: "Failed to fetch student" });
//   }
// };
const getStudentById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid student ID" });
    }

    // Check if populate is requested
    const shouldPopulate = req.query.populate === 'enrollments';
    
    let studentQuery = User.findOne({ _id: req.params.id, role: 'student' })
      .select('-password -resetCode -resetCodeExpires');

    if (shouldPopulate) {
      studentQuery = studentQuery.populate({
        path: 'enrollments',
        select: 'name subject status teacher', // Only include these fields
        populate: {
          path: 'teacher',
          select: 'username' // Only include teacher's username
        }
      });
    }

    const student = await studentQuery.lean();
    console.log("Fetched student data:", student);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    
    res.status(200).json(student);
  } catch (error) {
    console.error("Error fetching student by ID:", error);
    res.status(500).json({ message: "Failed to fetch student" });
  }
}; 
const addStudent = async (req, res) => {
    try {
      // Include grade in destructuring
      const { username, email, password, grade } = req.body;

      if (!grade) {
         return res.status(400).json({ message: "Student grade level is required" });
      }
      // Add grade validation if necessary (e.g., check against allowed grades)

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
        grade: grade,      // Assign grade
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
         grade: newStudent.grade,
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

        const { username, email, grade } = req.body;

        // Basic validation for presence
        if (!username && !email && !grade) {
           return res.status(400).json({ message: "No update fields provided." });
        }

        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (email !== undefined) updateData.email = email;
        if (grade !== undefined) updateData.grade = grade;

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
        ).select('-password -resetCode -resetCodeExpires'); // Exclude sensitive info

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
         if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid student ID" });
         }

        const studentId = req.params.id;
        const student = await User.findOneAndDelete({ _id: studentId, role: 'student' }); // Find and delete in one go

        if (!student) {
            return res.status(404).json({ message: "Student not found or user is not a student" });
        }

        // Post-deletion cleanup: Remove student from course enrollments
        if (student.enrollments && student.enrollments.length > 0) {
            await Course.updateMany(
                { _id: { $in: student.enrollments } },
                { $pull: { students: studentId } } // Remove student's ID from the 'students' array in courses
            );
            console.log(`Removed student ${studentId} from ${student.enrollments.length} course enrollment lists.`);
        }


        // Log activity
        await logAdminActivity(req, 'STUDENT_REMOVED', 'User', studentId, student.username);

        res.status(200).json({ message: "Student removed successfully" });
    } catch (error) {
        console.error("Error removing student:", error);
        res.status(500).json({ message: "Failed to remove student" });
    }
};


const enrollStudentInCourse = async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: 'Invalid Student or Course ID' });
    }

    // Use Promise.all for concurrent checks
    const [student, course] = await Promise.all([
      User.findOne({ _id: studentId, role: 'student' }),
      Course.findById(courseId)
    ]);

    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!course) return res.status(404).json({ message: 'Course not found' });
     if (course.status !== 'approved') {
         return res.status(400).json({ message: 'Cannot enroll student in a non-approved course' });
     }

    // Check if already enrolled
    const isAlreadyEnrolledStudent = student.enrollments?.includes(courseId) ?? false;
    const isAlreadyEnrolledCourse = course.students?.includes(studentId) ?? false;

    if (isAlreadyEnrolledStudent || isAlreadyEnrolledCourse) {
        // If inconsistent, fix it, otherwise return message
        if (!isAlreadyEnrolledStudent) await User.findByIdAndUpdate(studentId, { $addToSet: { enrollments: courseId } });
        if (!isAlreadyEnrolledCourse) await Course.findByIdAndUpdate(courseId, { $addToSet: { students: studentId } });
        return res.status(400).json({ message: 'Student is already enrolled in this course' });
    }


    // Perform updates using $addToSet to prevent duplicates
    await Promise.all([
      User.findByIdAndUpdate(studentId, { $addToSet: { enrollments: courseId } }),
      Course.findByIdAndUpdate(courseId, { $addToSet: { students: studentId } })
    ]);

     // Log activity
     await logAdminActivity(req, 'STUDENT_ENROLLED', 'User', studentId, student.username, { courseId: courseId, courseName: course.name });


    res.status(200).json({ message: 'Student enrolled successfully' });

  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({ message: 'Failed to enroll student' });
  }
};


const unenrollStudentFromCourse = async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId) || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: 'Invalid Student or Course ID' });
    }

      // Optional: Check if student and course exist before proceeding
      const [studentExists, courseExists] = await Promise.all([
          User.countDocuments({ _id: studentId, role: 'student' }),
          Course.countDocuments({ _id: courseId })
      ]);
       if (studentExists === 0) return res.status(404).json({ message: 'Student not found' });
       if (courseExists === 0) return res.status(404).json({ message: 'Course not found' });

    // Use $pull to remove from arrays
    await Promise.all([
      User.findByIdAndUpdate(studentId, { $pull: { enrollments: courseId } }),
      Course.findByIdAndUpdate(courseId, { $pull: { students: studentId } })
    ]);

     // Log activity (fetch names before pull for logging, or just use IDs)
    // If you need names, fetch student/course before the pull operations
    await logAdminActivity(req, 'STUDENT_UNENROLLED', 'User', studentId, 'N/A', { courseId: courseId }); // User name might be fetched if needed

    res.status(200).json({ message: 'Student unenrolled successfully' });

  } catch (error) {
    console.error('Error unenrolling student:', error);
    res.status(500).json({ message: 'Failed to unenroll student' });
  }
};
//////////////////////////////////////////////////////////

// 4. Reports
const getReports = async (req, res) => {
  try {
    const [courses, teachers, students] = await Promise.all([
        Course.find({}).lean(),
        User.find({ role: 'teacher' }).select('username courses').lean(),
        User.find({ role: 'student' }).select('grade').lean() // <-- Fetch students with grade
    ]);

    const statusCounts = { pending: 0, approved: 0, rejected: 0, total: courses.length };
    const coursesPerSubject = {};
    const coursesPerGrade = {};

    courses.forEach(course => {
        if (statusCounts.hasOwnProperty(course.status)) {
            statusCounts[course.status]++;
        }
        const subject = course.subject || 'Uncategorized';
        coursesPerSubject[subject] = (coursesPerSubject[subject] || 0) + 1;
        const grade = course.grade || 'Uncategorized';
        coursesPerGrade[grade] = (coursesPerGrade[grade] || 0) + 1;
    });

     const subjectDistribution = Object.entries(coursesPerSubject).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);
     const gradeDistribution = Object.entries(coursesPerGrade).map(([name, count]) => ({ name, count })).sort((a,b) => a.name.localeCompare(b.name)); // Sort grades alphabetically/numerically if possible
     const coursesPerTeacher = teachers.map(teacher => ({
        name: teacher.username,
        count: teacher.courses ? teacher.courses.length : 0
     })).sort((a, b) => b.count - a.count);

        // *** --- NEW: Student Calculations --- ***
    const totalStudents = students.length; // Total count
    const studentsPerGrade = {};
    students.forEach(student => {
        const grade = student.grade || 'Ungraded'; // Handle missing grade for students
        studentsPerGrade[grade] = (studentsPerGrade[grade] || 0) + 1;
    });
    // Convert to array format for charts
    const studentGradeDistribution = Object.entries(studentsPerGrade)
                                      .map(([name, count]) => ({ name, count }))
                                      .sort((a,b) => a.name.localeCompare(b.name)); // Sort by grade name
    // *** --- END: Student Calculations --- ***

    const placeholderCompletionRate = 0.0; // Set to 0 until implemented

    const reportData = {
        courseStatusCounts: statusCounts,
        subjectDistribution: subjectDistribution,
        gradeDistribution: gradeDistribution,
        coursesPerTeacher: coursesPerTeacher,
        totalStudents: totalStudents,                 // <-- Add total students
        studentGradeDistribution: studentGradeDistribution, // <-- Add student distribution
        placeholderCourseCompletionRate: placeholderCompletionRate
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
  getActivityLog
};