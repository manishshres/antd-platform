const { ConfigService } = require('@nestjs/config');
const { TelnyxService } = require('./dist/src/telnyx/telnyx.service');

async function test() {
  const config = new ConfigService();
  const service = new TelnyxService(config);

  try {
    const assistantsRes = await service.getAssistants();
    const assistant = assistantsRes.data[0];
    if (!assistant) return;

    console.log(`Updating assistant ${assistant.id}...`);
    await service.updateAssistantDynamicVariable(assistant.id, { test_key: "hello_world" });
    
    const updated = await service.getAssistant(assistant.id);
    console.log('Updated dynamic variables:', updated.data ? updated.data.dynamic_variables : updated.dynamic_variables);
  } catch (e) {
    console.error('Error', e);
  }
}

test();
