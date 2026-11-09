import { prisma } from "../config/db.prismaSQL.js";
import {
  contactMessageSchema,
  ALLOWED_ENQUIRY_TOPICS,
} from "../Validators/ZodSchema.js";

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Public endpoint to submit a Contact Us message.
 * POST /api/contact
 * No authentication required.
 */
export async function submitContactMessage(req, res) {
  try {
    const validationResult = contactMessageSchema.safeParse(req.body);

    if (!validationResult.success) {
      const issues = validationResult.error.issues;
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
        details: issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const { name, email, enquiryTopic, message } = validationResult.data;

    const created = await prisma.contactMessage.create({
      data: {
        name,
        email,
        enquiryTopic,
        message,
      },
      select: {
        id: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Your message has been received successfully. Our team will get back to you shortly.",
      data: {
        id: created.id,
      },
    });
  } catch (error) {
    console.error("[ContactController] submitContactMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal error occurred while processing your request. Please try again later.",
    });
  }
}

/**
 * Protected endpoint for Admins and SuperAdmins to view contact messages with pagination and filtering.
 * GET /api/contact
 * Query parameters:
 *  - page (default: 1)
 *  - limit (default: 10, max: 100)
 *  - enquiryTopic (optional filter)
 *  - search or q (optional search by name or email)
 */
export async function getContactMessages(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const where = {};

    const rawTopic = req.query.enquiryTopic || req.query.topic;
    if (rawTopic && typeof rawTopic === "string") {
      const normalizedTopic = rawTopic.trim().toLowerCase();
      if (ALLOWED_ENQUIRY_TOPICS.includes(normalizedTopic)) {
        where.enquiryTopic = normalizedTopic;
      }
    }

    const rawSearch = req.query.search || req.query.q;
    if (rawSearch && typeof rawSearch === "string" && rawSearch.trim()) {
      const searchTerm = rawSearch.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
      ];
    }

    const [totalRecords, messages] = await prisma.$transaction([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          enquiryTopic: true,
          message: true,
          createdAt: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalRecords / limit) || 0;
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        currentPage: page,
        limit,
        totalRecords,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
    });
  } catch (error) {
    console.error("[ContactController] getContactMessages error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal error occurred while fetching contact messages.",
    });
  }
}

/**
 * Protected endpoint for Admins to view a single contact message by UUID.
 * GET /api/contact/:id
 */
export async function getContactMessageById(req, res) {
  try {
    const { id } = req.params;
    if (!id || !isUuid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact message ID format",
      });
    }

    const message = await prisma.contactMessage.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        enquiryTopic: true,
        message: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Contact message not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("[ContactController] getContactMessageById error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal error occurred while fetching the contact message.",
    });
  }
}

/**
 * Protected endpoint for Admins and SuperAdmins to delete a contact message.
 * DELETE /api/contact/:id
 */
export async function deleteContactMessage(req, res) {
  try {
    const id = req.params.id || req.body?.id;
    if (!id || !isUuid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contact message ID format",
      });
    }

    const message = await prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Contact message not found",
      });
    }

    await prisma.contactMessage.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Contact message deleted successfully",
      data: { id },
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Contact message not found",
      });
    }
    console.error("[ContactController] deleteContactMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal error occurred while deleting the contact message.",
    });
  }
}

