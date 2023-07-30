import db, { eq } from "database/drizzle";
import { users } from "database/drizzle/schema";
import prisma from "./prisma";

export async function getUser(id: string) {
	const user = await prisma.user.findUniqueOrThrow({
		where: {
			id,
		},
	});
	return user;
}

export const incCount = async (id: string, name: string) => {
	const user = await db.query.users.findFirst({
		columns: {
			counts: true,
		},
		where: eq(users.id, id),
	});
	const counts = (user?.counts || {}) as Record<string, number>;
	return prisma.user.upsert({
		create: {
			id,
			counts: {
				[name]: 1,
			},
		},
		update: {
			counts: {
				...counts,
				[name]: (counts[name] || 0) + 1,
			},
		},
		where: {
			id,
		},
	});
};
