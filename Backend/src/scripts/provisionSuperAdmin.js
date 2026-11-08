import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../config/db.prismaSQL.js";
import { ROLES } from "../Middleware/authentication.Mw.js";

/**
 * SuperAdmin CLI Provisioning Utility
 *
 * Usage:
 *   node --env-file=.env src/scripts/provisionSuperAdmin.js --email="admin@example.com"
 *   node --env-file=.env src/scripts/provisionSuperAdmin.js --email="admin@example.com" --password="SuperSecurePassword123!" --name="Root Admin"
 *   SUPER_ADMIN_EMAIL=admin@example.com node --env-file=.env src/scripts/provisionSuperAdmin.js
 */

const parseCliArgs = () => {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--email=")) {
      options.email = arg.split("=")[1];
    } else if (arg === "--email" && args[i + 1]) {
      options.email = args[++i];
    } else if (arg.startsWith("--password=")) {
      options.password = arg.split("=")[1];
    } else if (arg === "--password" && args[i + 1]) {
      options.password = args[++i];
    } else if (arg.startsWith("--name=")) {
      options.name = arg.split("=")[1];
    } else if (arg === "--name" && args[i + 1]) {
      options.name = args[++i];
    } else if (!arg.startsWith("--") && !options.email) {
      options.email = arg;
    }
  }

  return options;
};

const validateEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email.trim());
};

async function provisionSuperAdmin() {
  const cliArgs = parseCliArgs();
  const rawEmail = cliArgs.email || process.env.SUPER_ADMIN_EMAIL;
  const rawPassword = cliArgs.password || process.env.SUPER_ADMIN_PASSWORD;
  const rawName = cliArgs.name || process.env.SUPER_ADMIN_NAME || "Super Admin";

  if (!rawEmail) {
    console.error("\n❌ Error: Target email is required.");
    console.error("Usage:");
    console.error("  node --env-file=.env src/scripts/provisionSuperAdmin.js --email=\"user@example.com\"");
    console.error("  node --env-file=.env src/scripts/provisionSuperAdmin.js --email=\"new@example.com\" --password=\"SecurePass123!\"");
    console.error("  SUPER_ADMIN_EMAIL=user@example.com node --env-file=.env src/scripts/provisionSuperAdmin.js\n");
    process.exit(1);
  }

  const email = rawEmail.trim().toLowerCase();
  if (!validateEmail(email)) {
    console.error(`\n❌ Error: '${rawEmail}' is not a valid email address.\n`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`   SUPER_ADMIN PROVISIONING PROCESS`);
  console.log(`======================================================`);
  console.log(`Target Email: ${email}`);

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    if (existingUser.deleted) {
      console.log(`⚠️ User account exists but is currently flagged as deleted.`);
      console.log(`Reactivating account and granting ${ROLES.SUPER_ADMIN} role...`);
    }

    if (existingUser.role === ROLES.SUPER_ADMIN && !existingUser.deleted) {
      console.log(`\n✅ Idempotent: User '${email}' (ID: ${existingUser.id}) is already a ${ROLES.SUPER_ADMIN}.`);
      console.log(`No role changes required.\n`);
      return;
    }

    const previousRole = existingUser.role;

    // Atomically upgrade role, un-delete if soft-deleted, clear sessions to force fresh login, and audit log
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: ROLES.SUPER_ADMIN,
          deleted: false,
        },
      }),
      prisma.session.deleteMany({
        where: { userId: existingUser.id },
      }),
      prisma.roleAuditLog.create({
        data: {
          actorId: existingUser.id,
          targetId: existingUser.id,
          action: "PROVISION_SUPER_ADMIN_CLI",
          oldRole: previousRole,
          newRole: ROLES.SUPER_ADMIN,
          userAgent: "CLI Script: provisionSuperAdmin.js",
        },
      }),
    ]);

    console.log(`\n✅ SUCCESS: User '${email}' (ID: ${updatedUser.id}) elevated from '${previousRole}' to '${ROLES.SUPER_ADMIN}'.`);
    console.log(`Active sessions cleared to enforce re-authentication.`);
    console.log(`Audit log recorded successfully.\n`);
    return;
  }

  // Account does not exist yet
  console.log(`User '${email}' was not found in the database.`);
  if (!rawPassword) {
    console.error(`\n❌ To create a new SuperAdmin account directly, please provide a secure password:`);
    console.error(`  node --env-file=.env src/scripts/provisionSuperAdmin.js --email="${email}" --password="<YourSecurePassword>" --name="${rawName}"\n`);
    console.error(`Alternatively, register the user normally and rerun this provisioning command.\n`);
    process.exit(1);
  }

  if (rawPassword.length < 8) {
    console.error(`\n❌ Error: Password must be at least 8 characters in length.\n`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const newUser = await prisma.user.create({
    data: {
      name: rawName,
      email,
      password: hashedPassword,
      role: ROLES.SUPER_ADMIN,
      deleted: false,
    },
  });

  await prisma.roleAuditLog.create({
    data: {
      actorId: newUser.id,
      targetId: newUser.id,
      action: "CREATE_SUPER_ADMIN_CLI",
      oldRole: ROLES.USER,
      newRole: ROLES.SUPER_ADMIN,
      userAgent: "CLI Script: provisionSuperAdmin.js",
    },
  });

  console.log(`\n✅ SUCCESS: New ${ROLES.SUPER_ADMIN} account created!`);
  console.log(`ID:    ${newUser.id}`);
  console.log(`Name:  ${newUser.name}`);
  console.log(`Email: ${newUser.email}`);
  console.log(`Role:  ${newUser.role}`);
  console.log(`Audit log recorded successfully.\n`);
}

provisionSuperAdmin()
  .catch((err) => {
    console.error("\n❌ Fatal error during provisioning:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

