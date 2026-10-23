/** 保存済みのSMTP設定で、指定した宛先にサンプル通知を送る。宛先は保存しない。 */
export interface NotificationTestGateway {
	sendTest(to: string, templateId: string): Promise<void>;
}
