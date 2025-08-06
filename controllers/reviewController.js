// backend/controllers/reviewController.js
const Review = require("../models/reviewModel");
const Course = require("../models/courseModel");
const Enrollment = require("../models/EnrollmentModel"); // Need to check enrollment
const mongoose = require("mongoose");

/**
 * @desc    Get all reviews for a specific course
 * @route   GET /api/courses/:courseId/reviews
 * @access  Public
 */
const getCourseReviews = async (req, res) => {
  try {
    const courseId = req.params.courseId;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: "Invalid Course ID" });
    }

    // Optional: Add pagination later if needed
    const reviews = await Review.find({
      courseId: courseId,
      // status: "approved", // Uncomment if you add an approval status
    })
      .sort({ createdAt: -1 }) // Show newest reviews first
      .lean(); // Use lean for performance if not modifying docs

    res.status(200).json(reviews);
  } catch (error) {
    console.error("Error fetching course reviews:", error);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
};

/**
 * @desc    Create a new review for a course
 * @route   POST /api/courses/:courseId/reviews
 * @access  Private (Student only, enrolled)
 */
const createReview = async (req, res) => {
    try {
      const courseId = req.params.courseId;
      const studentId = req.user.id;
      const studentName = req.user.username;
      const { rating, comment } = req.body;
  
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid Course ID" });
      }
  
      // 1. Check if the course exists and is approved (students likely shouldn't review unapproved courses)
      const courseExists = await Course.findOne({ _id: courseId, status: 'approved' }).select("_id");
      if (!courseExists) {
        return res.status(404).json({ message: "Approved course not found or not available for review" });
      }
  
      // 2. Check if the student is enrolled using the CORRECT field names
      console.log(`[createReview] Checking enrollment for Student: ${studentId}, Course: ${courseId}`); // Add log
      const enrollment = await Enrollment.findOne({
        student: studentId, // *** FIX: Use 'student' field name ***
        course: courseId,   // *** FIX: Use 'course' field name ***
      }).lean(); // Use lean if you only need to check existence
  
      if (!enrollment) {
        console.log(`[createReview] Enrollment check failed for Student: ${studentId}, Course: ${courseId}`); // Add log
        return res
          .status(403)
          .json({ message: "You must be enrolled in this course to leave a review." });
      }
       console.log(`[createReview] Enrollment found:`, enrollment); // Add log
  
      // 3. Check if the student has already reviewed this course
      const existingReview = await Review.findOne({ courseId: courseId, studentId: studentId }); // Keep using studentId here as it matches Review schema
      if (existingReview) {
        return res
          .status(400)
          .json({ message: "You have already reviewed this course." });
      }
  
      // 4. Create and save the new review
      const newReview = new Review({
        courseId, // Matches Review schema
        studentId, // Matches Review schema
        studentName,
        rating,
        comment,
      });
  
      await newReview.save(); // This triggers the post-save hook to update course rating
  
      res.status(201).json({ message: "Review submitted successfully", review: newReview });
  
    } catch (error) {
      if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((err) => err.message);
        return res.status(400).json({ message: messages.join(", ") });
      }
      console.error("Error creating review:", error);
      res.status(500).json({ message: "Failed to submit review" });
    }
  };
// --- NEW: updateReview ---
/**
 * @desc    Update an existing review
 * @route   PUT /api/courses/:courseId/reviews/:reviewId
 * @access  Private (Student who wrote the review)
 */
const updateReview = async (req, res) => {
    try {
      const { reviewId } = req.params; // Get reviewId from params
      const studentId = req.user.id; // Authenticated user
      const { rating, comment } = req.body;
  
      if (!mongoose.Types.ObjectId.isValid(reviewId)) {
        return res.status(400).json({ message: "Invalid Review ID" });
      }
  
      const review = await Review.findById(reviewId);
  
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }
  
      // Authorization: Check if the logged-in user is the author of the review
      if (review.studentId.toString() !== studentId) {
        return res.status(403).json({ message: "User not authorized to update this review" });
      }
  
      // Update fields if provided
      if (rating !== undefined) review.rating = rating;
      if (comment !== undefined) review.comment = comment;
      // Optional: Reset status to pending if you have approval flow
      // review.status = "pending";
  
      const updatedReview = await review.save();
  
      // Optional: Recalculate average rating on the Course model here
      // await updateCourseRating(review.courseId);
  
      res.status(200).json({ message: "Review updated", review: updatedReview });
  
    } catch (error) {
      if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((err) => err.message);
        return res.status(400).json({ message: messages.join(", ") });
      }
      console.error("Error updating review:", error);
      res.status(500).json({ message: "Failed to update review" });
    }
  };
  
  // --- NEW: deleteReview ---
  /**
   * @desc    Delete a review
   * @route   DELETE /api/courses/:courseId/reviews/:reviewId
   * @access  Private (Student who wrote the review or Admin)
   */
  const deleteReview = async (req, res) => {
    try {
      const { reviewId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role; // Assuming role is available in req.user
  
      if (!mongoose.Types.ObjectId.isValid(reviewId)) {
        return res.status(400).json({ message: "Invalid Review ID" });
      }
  
      const review = await Review.findById(reviewId);
  
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }
  
      // Authorization: Allow deletion if user is the author OR if user is an admin
      if (review.studentId.toString() !== userId && userRole !== "admin") {
        return res.status(403).json({ message: "User not authorized to delete this review" });
      }
  
      await review.deleteOne(); // Use deleteOne() on the document
  
      // Optional: Recalculate average rating on the Course model here
      // await updateCourseRating(review.courseId);
  
      res.status(200).json({ message: "Review deleted successfully" });
  
    } catch (error) {
      console.error("Error deleting review:", error);
      res.status(500).json({ message: "Failed to delete review" });
    }
  };
  
  
  module.exports = {
    getCourseReviews,
    createReview,
    updateReview,
    deleteReview, 
  };