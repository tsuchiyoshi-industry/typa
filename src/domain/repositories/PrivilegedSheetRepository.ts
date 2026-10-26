import type { PrivilegedSheetOperation } from "../entities/PrivilegedSheetOperation";

/** Admin の特権操作。操作・通知の抑止・監査記録は DB の同一トランザクションで行う。 */
export interface PrivilegedSheetRepository {
	execute(operation: PrivilegedSheetOperation): Promise<void>;
}
