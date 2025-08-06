// backend/controllers/subjectController.js
const Subject = require('../models/SubjectModel');
const Course = require('../models/courseModel'); // To check for associated courses before delete
const mongoose = require('mongoose');

// Create Subject (Admin only)
exports.createSubject = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Subject name is required.' });
        }
        const existingSubject = await Subject.findOne({ name });
        if (existingSubject) {
            return res.status(400).json({ message: `Subject '${name}' already exists.` });
        }
        const newSubject = new Subject({ name, description });
        await newSubject.save();
        // TODO: Log admin activity
        res.status(201).json({ message: 'Subject created successfully.', subject: newSubject });
    } catch (error) {
        console.error("Error creating subject:", error);
        res.status(500).json({ message: 'Failed to create subject.' });
    }
};

// Get All Subjects (Admin, Teacher, Student)
exports.getAllSubjects = async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ name: 1 }).lean();
        res.status(200).json(subjects);
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ message: 'Failed to fetch subjects.' });
    }
};

// Get Subject by ID (Admin, Teacher, Student)
exports.getSubjectById = async (req, res) => {
    try {
        const { subjectId } = req.params;
         if (!mongoose.Types.ObjectId.isValid(subjectId)) { return res.status(400).json({ message: 'Invalid Subject ID format.' }); }
        const subject = await Subject.findById(subjectId).lean();
        if (!subject) {
            return res.status(404).json({ message: 'Subject not found.' });
        }
        res.status(200).json(subject);
    } catch (error) {
        console.error("Error fetching subject by ID:", error);
        res.status(500).json({ message: 'Failed to fetch subject.' });
    }
};

// Update Subject (Admin only)
exports.updateSubject = async (req, res) => {
    try {
        const { subjectId } = req.params;
        const { name, description } = req.body;
         if (!mongoose.Types.ObjectId.isValid(subjectId)) { return res.status(400).json({ message: 'Invalid Subject ID format.' }); }

        if (!name && !description) {
             return res.status(400).json({ message: 'No update fields provided (name or description).' });
        }
        const updateData = {};
        if (name) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();

        // Check if new name already exists (excluding current subject)
        if (name) {
             const existingSubject = await Subject.findOne({ name: updateData.name, _id: { $ne: subjectId } });
             if (existingSubject) { return res.status(400).json({ message: `Subject name '${updateData.name}' is already in use.` }); }
        }

        const updatedSubject = await Subject.findByIdAndUpdate(subjectId, updateData, { new: true, runValidators: true });
        if (!updatedSubject) {
            return res.status(404).json({ message: 'Subject not found.' });
        }
        // TODO: Log admin activity
        res.status(200).json({ message: 'Subject updated successfully.', subject: updatedSubject });
    } catch (error) {
        console.error("Error updating subject:", error);
         if (error.code === 11000) { // Handle potential unique index violation if findOne check fails race condition
             return res.status(400).json({ message: `Subject name '${req.body.name}' is already in use.` });
         }
        res.status(500).json({ message: 'Failed to update subject.' });
    }
};

// Delete Subject (Admin only)
exports.deleteSubject = async (req, res) => {
    try {
        const { subjectId } = req.params;
         if (!mongoose.Types.ObjectId.isValid(subjectId)) { return res.status(400).json({ message: 'Invalid Subject ID format.' }); }

        // **Crucial Check:** Prevent deletion if courses are associated with this subject
        const courseCount = await Course.countDocuments({ subject: subjectId });
        if (courseCount > 0) {
            return res.status(400).json({ message: `Cannot delete subject. ${courseCount} course(s) are associated with it. Please reassign or delete those courses first.` });
        }

        const deletedSubject = await Subject.findByIdAndDelete(subjectId);
        if (!deletedSubject) {
            return res.status(404).json({ message: 'Subject not found.' });
        }
        // TODO: Log admin activity
        res.status(200).json({ message: 'Subject deleted successfully.' });
    } catch (error) {
        console.error("Error deleting subject:", error);
        res.status(500).json({ message: 'Failed to delete subject.' });
    }
};