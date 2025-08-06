// backend/models/reviewModel.js
const mongoose = require("mongoose");
let Course;
try {
  Course = mongoose.model('Course');
} catch (error) {
  Course = require('./courseModel'); // Adjust path as needed
}
const reviewSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Course", // Reference to the Course model
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User", // Reference to the User model (student)
    },
    studentName: {
      // Denormalized for easier display, populated when creating review
      type: String,
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      required: true,
    },

    // Optional: Add an approval status if admins need to moderate reviews
    // status: {
    //   type: String,
    //   enum: ["pending", "approved", "rejected"],
    //   default: "pending",
    // },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

reviewSchema.index({ courseId: 1 });
reviewSchema.index({ courseId: 1, studentId: 1 }, { unique: true });

// *** STATIC METHOD to Calculate Average Rating ***
reviewSchema.statics.calculateAverageRating = async function(courseId) {
    console.log(`[calculateAverageRating] Calculating for Course: ${courseId}`);
    if (!courseId) {
        console.error("[calculateAverageRating] Error: courseId is undefined.");
        return; // Exit if no courseId
    }

    const stats = await this.aggregate([
        {
            $match: { courseId: new mongoose.Types.ObjectId(courseId) } // Ensure matching ObjectId
        },
        {
            $group: {
                _id: '$courseId', // Group by course
                nRating: { $sum: 1 }, // Count number of reviews
                avgRating: { $avg: '$rating' } // Calculate average rating
            }
        }
    ]);

    console.log(`[calculateAverageRating] Stats for Course ${courseId}:`, stats);

    try {
        if (stats.length > 0) {
            // If there are reviews, update the course
            const reviewCount = stats[0].nRating;
            // Round average to one decimal place
            const ratingAverage = Math.round(stats[0].avgRating * 10) / 10;

            await Course.findByIdAndUpdate(courseId, {
                reviewCount: reviewCount,
                ratingAverage: ratingAverage
            });
            console.log(`[calculateAverageRating] Updated Course ${courseId} with count=${reviewCount}, avg=${ratingAverage}`);
        } else {
            // If no reviews left, reset course stats to 0
            await Course.findByIdAndUpdate(courseId, {
                reviewCount: 0,
                ratingAverage: 0
            });
            console.log(`[calculateAverageRating] Reset Course ${courseId} stats to 0 (no reviews found).`);
        }
    } catch (error) {
        console.error(`[calculateAverageRating] Error updating course ${courseId}:`, error);
    }
};

// *** MIDDLEWARE HOOKS ***

// Call calculateAverageRating AFTER a review is saved (created or updated)
reviewSchema.post('save', async function() {
    // 'this' refers to the review document that was saved
    // Access the constructor to call the static method
    if (this.constructor.calculateAverageRating) {
        await this.constructor.calculateAverageRating(this.courseId);
    } else {
        console.error("Error in post-save hook: calculateAverageRating static not found.");
    }
});

// Call calculateAverageRating AFTER a review is deleted using findByIdAndDelete or document.deleteOne()
// Note: This hook needs access to the deleted document's data.
// We use a pre-hook to attach the document to the query object.
reviewSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  // 'this' is the document being deleted
  // Attach courseId to the query options so the post hook can access it
  this.deletedCourseId = this.courseId;
  next();
});

reviewSchema.post('deleteOne', { document: true, query: false }, async function() {
  // 'this' is the document that was deleted
  if (this.constructor.calculateAverageRating && this.deletedCourseId) {
     await this.constructor.calculateAverageRating(this.deletedCourseId);
  } else {
      console.error("Error in post-deleteOne hook: calculateAverageRating static or deletedCourseId not found.");
  }
});

// IMPORTANT: Mongoose middleware for query operations like findOneAndDelete
// might require slightly different hook setup if you use those methods for deletion.
// The document middleware approach above works well for review.deleteOne().

const Review = mongoose.model("Review", reviewSchema);
module.exports = Review;

