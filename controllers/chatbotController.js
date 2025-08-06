
// backend/controllers/chatbotController.js
const mongoose = require('mongoose');
const User = require('../models/UserModel'); // If needed for user-specific context
const Course = require('../models/courseModel');
const Subject = require('../models/SubjectModel');
const Lesson = require('../models/LessonModel');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

let genAI;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("Chatbot: Google Generative AI client initialized.");
} else {
    console.warn("Chatbot: GEMINI_API_KEY missing. Chatbot AI features will be unavailable.");
}

const buildSystemPrompt = (subjectsData = []) => {
    let subjectListInfo = "various subjects including Technology, Arts, and Sciences.";
    if (subjectsData.length > 0) {
        subjectListInfo = subjectsData.map(s => `- ${s.name}${s.description ? ': ' + s.description.substring(0, Math.min(50, s.description.length)) + '...' : ''}`).join('\n');
    }

    return `You are "MidaChat", a friendly, helpful, and knowledgeable academic assistant for the "Midadium" e-learning platform.
Your primary goal is to help students explore Midadium's offerings by providing detailed information about subjects, courses (including their descriptions, objectives, prices, and associated lessons), and specific lessons.
Prioritize answers related to Midadium's content. If a student asks about a topic, try to recommend relevant Midadium courses or subjects.
If a question is very generic and not related to learning or Midadium, gently guide the conversation back or state that your expertise lies with the platform.
Do not answer questions that are harmful, unethical, or completely off-topic from an educational context.
Keep answers concise, informative, and directly answer the student's query using the provided context when available.
When providing course details, mention the price if available.

Midadium offers courses in subjects like:
${subjectListInfo}

You do not have access to the student's personal enrollment data or progress unless explicitly provided in the current conversation turn's context.
If a student asks for help with assignments or specific lesson content beyond what's in the description/objectives, suggest they consult the lesson materials or their teacher AFTER enrolling.
When recommending courses, use the information provided in the "Relevant Midadium Platform Information" section of this prompt.
`;
};
const getPlatformContext = async (query, allSubjectsCache, chatHistory = []) => {
    const lowerQuery = query.toLowerCase();
    let contextSnippets = [];
    const MAX_SNIPPET_LENGTH = 150;
    const MAX_COURSES_TO_LIST = 5; // Max courses to show for a subject query
    const MAX_LESSONS_TO_LIST = 5; // Max lessons for a specific course query

    let identifiedSubjectName = null;

    // --- Attempt 1: Identify Subject from Current Query or Recent History ---
    // Check current query first
    for (const subj of allSubjectsCache) {
        if (lowerQuery.includes(subj.name.toLowerCase())) {
            identifiedSubjectName = subj.name;
            break;
        }
    }
    // If not in current query, check recent history for a subject mention
    if (!identifiedSubjectName && chatHistory.length > 0) {
        for (let i = chatHistory.length - 1; i >= Math.max(0, chatHistory.length - 2); i--) { // Check last 1-2 turns
            const turn = chatHistory[i];
            if (turn.role === 'user' || turn.role === 'model') { // Check both user and model turns for subject name
                const turnText = turn.parts[0].text.toLowerCase();
                for (const subj of allSubjectsCache) {
                    if (turnText.includes(subj.name.toLowerCase())) {
                        identifiedSubjectName = subj.name;
                        break;
                    }
                }
            }
            if (identifiedSubjectName) break;
        }
    }

    console.log(`[ChatBot Context] Identified subject from query/history: ${identifiedSubjectName}`);

    // --- If a subject was identified, fetch its courses ---
    if (identifiedSubjectName) {
        const subjectDoc = allSubjectsCache.find(s => s.name === identifiedSubjectName);
        if (subjectDoc) {
            const coursesInSubject = await Course.find({
                subject: subjectDoc._id, // Query by subject ID
                status: 'approved'
            }).select('name description objectives teacher price')
              .populate('teacher', 'username')
              .limit(MAX_COURSES_TO_LIST)
              .lean();

            if (coursesInSubject.length > 0) {
                contextSnippets.push(`Here are some courses available under the subject "${identifiedSubjectName}":\n` +
                    coursesInSubject.map(c =>
                        `- Course: "${c.name}" (Taught by: ${c.teacher?.username || 'N/A'}, Price: $${c.price ?? 0})\n  Description: ${c.description?.substring(0, MAX_SNIPPET_LENGTH) || 'N/A'}...\n  Objectives: ${c.objectives?.substring(0, MAX_SNIPPET_LENGTH) || 'N/A'}...`
                    ).join('\n\n')
                );
            } else {
                contextSnippets.push(`I found the subject "${identifiedSubjectName}", but it seems there are no specific courses listed under it at the moment, or they might not match other parts of your query. You can always browse all courses in the catalog!`);
            }
        }
    }

    // --- Search for Specific Courses by Name/Description (if no subject context or if query is specific) ---
    // Only run this if we didn't get strong subject-based results or if the query looks like a direct course search
    if (contextSnippets.length === 0 || (!identifiedSubjectName && lowerQuery.length > 5) ) { // Heuristic: query is somewhat specific
        const coursesByName = await Course.find({
            $or: [
                { name: { $regex: lowerQuery, $options: 'i' } },
                { description: { $regex: lowerQuery, $options: 'i' } }
            ],
            status: 'approved'
        }).select('name description objectives subject teacher price')
          .populate('subject', 'name')
          .populate('teacher', 'username')
          .limit(1) // If searching by name, likely want the most direct match
          .lean();

        if (coursesByName.length > 0) {
            contextSnippets.push("I found this Midadium course that might be relevant:\n" +
                coursesByName.map(c => // Should only be one due to limit(1)
                    `- Course: "${c.name}" (Subject: ${c.subject?.name || 'N/A'}, Taught by: ${c.teacher?.username || 'N/A'}, Price: $${c.price ?? 0})\n  Description: ${c.description?.substring(0, MAX_SNIPPET_LENGTH) || 'N/A'}...\n  Objectives: ${c.objectives?.substring(0, MAX_SNIPPET_LENGTH) || 'N/A'}...`
                ).join('\n\n')
            );
            // If one specific course found, fetch its lessons
            const specificCourse = coursesByName[0];
            const lessons = await Lesson.find({ course: specificCourse._id, status: 'ready' })
                                       .select('title objectives')
                                       .sort({ createdAt: 1 }).limit(MAX_LESSONS_TO_LIST).lean();
            if (lessons.length > 0) {
                contextSnippets.push(`\nFor the course "${specificCourse.name}", here are some initial lesson titles and objectives:\n` +
                    lessons.map(l => `- Lesson: "${l.title}"\n  Objectives: ${l.objectives?.substring(0, MAX_SNIPPET_LENGTH - 20) || 'N/A'}...`).join('\n')
                );
            }
        }
    }

 

     if (contextSnippets.length < 2 && (/project on|learn about|how to build|i want to make/i.test(lowerQuery))) {
        console.log("[ChatBot Context] Query seems like a learning goal. Fetching general course catalog info.");
        const allCoursesForRecommendation = await Course.find({ status: 'approved' })
            .select('name description subject price')
            .populate('subject', 'name')
            .limit(5) // Get a few diverse courses
            .lean();

        if (allCoursesForRecommendation.length > 0) {
            contextSnippets.push("\nTo help you with your project or learning goal, here are some Midadium courses you might find relevant:\n" +
                allCoursesForRecommendation.map(c =>
                    `- Course: "${c.name}" (Subject: ${c.subject?.name || 'N/A'}, Price: $${c.price ?? 0})\n  Description Snippet: ${c.description?.substring(0, 80) || 'N/A'}...`
                ).join('\n')
            );
        }
    }

   if (contextSnippets.length > 0) {
        // Join snippets and ensure total context isn't excessively long
        let fullContext = "\n\nHere's some specific information from the Midadium platform that might be relevant to your question:\n" + contextSnippets.join("\n\n---\n\n");
        const MAX_CONTEXT_LENGTH = 3000; // Adjust based on token limits and desired AI performance
        if (fullContext.length > MAX_CONTEXT_LENGTH) {
            fullContext = fullContext.substring(0, MAX_CONTEXT_LENGTH) + "... (context truncated)";
        }
        return fullContext;
    }
    return ""; // No specific context found, AI will rely on general knowledge and system prompt
};



exports.chatWithBot = async (req, res) => {
    if (!genAI) return res.status(503).json({ message: 'AI Service unavailable.' });

    try {
        const { message, history } = req.body; // `history` is an array of previous user/model messages
        const studentId = req.user.id;

        if (!message) return res.status(400).json({ message: 'Message content is required.' });

 // 1. Fetch all subjects once to build a comprehensive system prompt
        const allSubjects = await Subject.find().select('name description').lean(); // Fetch description too
        const systemPrompt = buildSystemPrompt(allSubjects);

        // 2. Retrieve relevant platform context based on the current user message
        const relevantPlatformContext = await getPlatformContext(message, allSubjects,history); // Pass allSubjects for context

        // 3. Construct the prompt for Gemini
        // For generateContent, prepend all context. For chat models, structure history.
        let fullPromptForGemini = systemPrompt;

        // Append conversational history (simplified for generateContent)
        if (history && Array.isArray(history)) {
            history.forEach(turn => {
               if (turn.parts && Array.isArray(turn.parts) && turn.parts.length > 0 && turn.parts[0].text) {
                if (turn.role === 'user') fullPromptForGemini += `\n\nPrevious Student: ${turn.parts[0].text}`;
                if (turn.role === 'model') fullPromptForGemini += `\n\nPrevious MidadChat: ${turn.parts[0].text}`;
            }
        });
    }
    fullPromptForGemini += relevantPlatformContext;
    fullPromptForGemini += `\n\nStudent: ${message}\nMidaChat:`;

        // console.log("[ChatBot] Full Prompt to Gemini:\n", fullPromptForGemini); // DEBUG: Log the full prompt
 const model = genAI.getGenerativeModel({
                         model: "gemini-1.5-flash-latest",
                         safetySettings: [ // Define safety settings explicitly
                            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE, },
                          ],
                          generationConfig: {
                            temperature: 0.6,
                            maxOutputTokens: 6600,
                          },
                     });
        // For non-streaming chat:
        // const result = await model.generateContent({ contents: conversationContents });
        // For streaming chat which is better for UX: model.generateContentStream
        const result = await model.generateContent(fullPromptForGemini); // Simpler for now with prepended context
        const response = result.response;

        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            // ... (handle blocked content or no response as in generateLessonFormat) ...
        const blockReason = response?.promptFeedback?.blockReason;
             const finishReason = response?.candidates?.[0]?.finishReason;
             console.error(`[ChatBot] AI Error. Block: ${blockReason}, Finish: ${finishReason}`);
             throw new Error(`AI did not provide a valid response. Block: ${blockReason}, Finish: ${finishReason}`);
        }
        const botReply = response.text().trim();
        console.log("[ChatBot] Gemini Reply:", botReply);
        res.status(200).json({ reply: botReply });

    } catch (error) {
        console.error("[ChatBot] Gemini API Call Error:", error);
        res.status(500).json({ message: `Chatbot error: ${error.message}` });
    }
};
