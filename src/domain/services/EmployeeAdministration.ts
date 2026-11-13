import {
	CAREER_COURSES,
	type EmployeeProfile,
	isValidEmployeeNo,
} from "../entities/EmployeeProfile";
import { err, ok, type Result } from "../Result";
import type { EmployeeRole } from "../valueObjects/EmployeeRole";

/**
 * 社員の管理操作(権限・利用・登録の取り消し・仮のパスワード・評価者・招待・仮登録)の業務のきまり。
 * 誰が操作できるか(Admin だけ)は EmployeeMasterAccessService が決める。ここは、操作してよい相手と内容。
 * DB の関数・トリガーも同じきまりで断る(EmployeeAdministrationSql.test.ts が突き合わせる)。
 */
export type EmployeeAdministrationError =
	/** 利用できる Admin が0名になる。action は、どの操作で起きたか(案内を変える)。 */
	| { kind: "lastUsableAdmin"; action: "role" | "suspend" | "reset" }
	| { kind: "selfSuspension" }
	| { kind: "selfReset" }
	| { kind: "selfPasswordReset" }
	| { kind: "notRegistered"; name: string }
	| { kind: "selfEvaluator" }
	| { kind: "cannotEvaluate"; name: string }
	| { kind: "suspended"; name: string }
	| { kind: "alreadyRegistered"; name: string }
	| { kind: "employeeNoInvalid" }
	| { kind: "nameMissing" }
	| { kind: "careerCourseUnknown" }
	| { kind: "employeeNoTaken"; employeeNo: string; name: string }
	| { kind: "secondaryConflict" }
	| { kind: "evaluatorMissing" };

type Check = Result<void, EmployeeAdministrationError>;
const pass: Check = ok(undefined);

/** 利用できる Admin: 利用中で、登録を済ませた(ログインできる) Admin。権限・利用・登録を管理できる人。 */
export const isUsableAdmin = (employee: EmployeeProfile): boolean =>
	employee.role.isAdmin() && employee.enabled && employee.registered;

/**
 * 対象を「利用できる Admin」でなくしてよいか。利用できる Admin を最低1名残す。
 * 誰も権限・利用・登録を管理できなくなるため。利用できない Admin(停止中・未登録)は数えない。
 */
function keepsUsableAdmin(
	target: EmployeeProfile,
	everyone: readonly EmployeeProfile[],
	action: "role" | "suspend" | "reset",
): Check {
	return !isUsableAdmin(target) ||
		everyone.some((employee) => employee.id !== target.id && isUsableAdmin(employee))
		? pass
		: err({ kind: "lastUsableAdmin", action });
}

/** 権限を変える。Admin にするのはいつでもよい。外すときは、利用できる Admin を残す。 */
export function checkRoleChange(
	target: EmployeeProfile,
	role: EmployeeRole,
	everyone: readonly EmployeeProfile[],
): Check {
	return role.isAdmin() ? pass : keepsUsableAdmin(target, everyone, "role");
}

/**
 * 利用を停止・再開する。自分は止められない(操作中のセッションごと使えなくなる)。
 * 止めるときは、利用できる Admin を残す。
 */
export function checkEnabledChange(
	operator: EmployeeProfile,
	target: EmployeeProfile,
	enabled: boolean,
	everyone: readonly EmployeeProfile[],
): Check {
	if (enabled) {
		return pass;
	}
	if (target.id === operator.id) {
		return err({ kind: "selfSuspension" });
	}
	return keepsUsableAdmin(target, everyone, "suspend");
}

/**
 * 登録を取り消す(ログイン用アカウントを消す)。自分の登録は取り消せない。登録していない社員には意味がない。
 * 利用できる Admin を残す。
 */
export function checkRegistrationReset(
	operator: EmployeeProfile,
	target: EmployeeProfile,
	everyone: readonly EmployeeProfile[],
): Check {
	if (target.id === operator.id) {
		return err({ kind: "selfReset" });
	}
	if (!target.registered) {
		return err({ kind: "notRegistered", name: target.name });
	}
	return keepsUsableAdmin(target, everyone, "reset");
}

/**
 * 仮のパスワードを設定する。相手は、利用中で登録を済ませた別の社員。自分のは対象外
 * (自分で変えればよく、操作中のセッションも切れてしまう)。
 */
export function checkPasswordReset(operator: EmployeeProfile, target: EmployeeProfile): Check {
	if (target.id === operator.id) {
		return err({ kind: "selfPasswordReset" });
	}
	if (!target.registered) {
		return err({ kind: "notRegistered", name: target.name });
	}
	return target.enabled ? pass : err({ kind: "suspended", name: target.name });
}

/**
 * 評価者を設定する(null は外す)。本人は自分の評価者になれない。
 * 評価者になれるのは、評価者になれる人(canBeEvaluator: 評価者の権限を持つ人と役員)だけ。
 */
export function checkEvaluatorAssignment(
	target: EmployeeProfile,
	evaluator: EmployeeProfile | null,
): Check {
	if (!evaluator) {
		return pass;
	}
	if (evaluator.id === target.id) {
		return err({ kind: "selfEvaluator" });
	}
	return evaluator.canBeEvaluator() ? pass : err({ kind: "cannotEvaluate", name: evaluator.name });
}

/** 招待コードを発行する。相手は利用中で、まだ登録していない社員だけ。 */
export function checkInvitation(target: EmployeeProfile): Check {
	if (!target.enabled) {
		return err({ kind: "suspended", name: target.name });
	}
	return target.registered ? err({ kind: "alreadyRegistered", name: target.name }) : pass;
}

/** 仮登録する社員。社員番号・氏名は、入力の揺れ(全角・前後の空白)をそろえた後の値。 */
export interface NewEmployeeDraft {
	employeeNo: string;
	name: string;
	careerCourse: string;
	primaryEvaluatorEmployeeNo: string | null;
	secondaryEvaluatorEmployeeNo: string | null;
	noSecondaryEvaluator: boolean;
}

/**
 * 社員を仮登録する。社員番号はログインIDになる(isValidEmployeeNo)。ログインIDは小文字にそろえて扱うので、
 * 大文字・小文字だけが違う番号も同じ人とみなす。二次評価者と「なし」は同時に選べない。
 * 評価者は、いる社員で、評価者になれる人だけ。等級があるかは、等級の一覧で確かめる(呼ぶ側)。
 */
export function checkNewEmployee(
	draft: NewEmployeeDraft,
	everyone: readonly EmployeeProfile[],
): Check {
	if (!isValidEmployeeNo(draft.employeeNo)) {
		return err({ kind: "employeeNoInvalid" });
	}
	if (!draft.name) {
		return err({ kind: "nameMissing" });
	}
	if (!(CAREER_COURSES as readonly string[]).includes(draft.careerCourse)) {
		return err({ kind: "careerCourseUnknown" });
	}
	const taken = everyone.find(
		(employee) => employee.employeeNo.toLowerCase() === draft.employeeNo.toLowerCase(),
	);
	if (taken) {
		return err({ kind: "employeeNoTaken", employeeNo: taken.employeeNo, name: taken.name });
	}
	if (draft.secondaryEvaluatorEmployeeNo !== null && draft.noSecondaryEvaluator) {
		return err({ kind: "secondaryConflict" });
	}
	for (const evaluatorNo of [
		draft.primaryEvaluatorEmployeeNo,
		draft.secondaryEvaluatorEmployeeNo,
	]) {
		if (evaluatorNo === null) {
			continue;
		}
		const evaluator = everyone.find((employee) => employee.employeeNo === evaluatorNo);
		if (!evaluator) {
			return err({ kind: "evaluatorMissing" });
		}
		if (!evaluator.canBeEvaluator()) {
			return err({ kind: "cannotEvaluate", name: evaluator.name });
		}
	}
	return pass;
}

export function describeEmployeeAdministrationError(error: EmployeeAdministrationError): string {
	switch (error.kind) {
		case "lastUsableAdmin":
			return {
				role: "Admin が0名になるため変更できません。先に別の社員を Admin にしてから変更してください。",
				suspend:
					"利用できる Admin が0名になるため停止できません。先に別の社員を Admin にしてください。",
				reset:
					"利用できる Admin が0名になるため取り消せません。先に別の社員を Admin にしてください。",
			}[error.action];
		case "selfSuspension":
			return "自分自身の利用は停止できません。";
		case "selfReset":
			return "自分自身の登録は取り消せません。";
		case "selfPasswordReset":
			return "自分のパスワードは再設定できません。";
		case "notRegistered":
			return `${error.name}さんはまだ登録していません。`;
		case "selfEvaluator":
			return "自分自身を評価者として設定することはできません。";
		case "cannotEvaluate":
			return `${error.name}さんは評価者の権限を持っていないため、評価者に設定できません。`;
		case "suspended":
			return `${error.name}さんは利用停止中です。先に利用を再開してください。`;
		case "alreadyRegistered":
			return `${error.name}さんは登録済みです。`;
		case "employeeNoInvalid":
			return "社員番号は半角英数字・ハイフン・アンダースコアで入力してください。";
		case "nameMissing":
			return "氏名を入力してください。";
		case "careerCourseUnknown":
			return "キャリアコースを選んでください。";
		case "employeeNoTaken":
			return `社員番号 ${error.employeeNo} は${error.name}さんが使っています。`;
		case "secondaryConflict":
			return "二次評価者と「なし」は同時に指定できません。";
		case "evaluatorMissing":
			return "評価者が見つかりませんでした。";
	}
}
