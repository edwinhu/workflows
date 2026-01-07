/**
 * Workflows plugin for OpenCode.ai
 *
 * Provides custom tools for loading and discovering development,
 * data science, and writing skills with prompt generation.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { tool } from '@opencode-ai/plugin/tool';
import * as skillsCore from '../../lib/skills-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WorkflowsPlugin = async ({ client, directory }) => {
  const homeDir = os.homedir();
  const projectSkillsDir = path.join(directory, '.opencode/skills');
  // Derive workflows skills dir from plugin location (works for both symlinked and local installs)
  const workflowsSkillsDir = path.resolve(__dirname, '../../skills');
  const personalSkillsDir = path.join(homeDir, '.config/opencode/skills');

  // Helper to generate bootstrap content
  const getBootstrapContent = (compact = false) => {
    const usingWorkflowsPath = skillsCore.resolveSkillPath('using-workflows', workflowsSkillsDir, personalSkillsDir);
    if (!usingWorkflowsPath) return null;

    const fullContent = fs.readFileSync(usingWorkflowsPath.skillFile, 'utf8');
    const content = skillsCore.stripFrontmatter(fullContent);

    const toolMapping = compact
      ? `**Tool Mapping:** TodoWrite->update_plan, Task->@mention, Skill->use_skill

**Skills naming (priority order):** project: > personal > workflows:`
      : `**Tool Mapping for OpenCode:**
When skills reference tools you don't have, substitute OpenCode equivalents:
- \`TodoWrite\` → \`update_plan\`
- \`Task\` tool with subagents → Use OpenCode's subagent system (@mention)
- \`Skill\` tool → \`use_skill\` custom tool
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\` → Your native tools

**Skills naming (priority order):**
- Project skills: \`project:skill-name\` (in .opencode/skills/)
- Personal skills: \`skill-name\` (in ~/.config/opencode/skills/)
- Workflows skills: \`workflows:skill-name\`
- Project skills override personal, which override workflows when names match`;

    return `<EXTREMELY_IMPORTANT>
You have access to the workflows library.

**IMPORTANT: The using-workflows skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the use_skill tool to load "using-workflows" - that would be redundant. Use use_skill only for OTHER skills.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
  };

  // Helper to inject bootstrap via session.prompt
  const injectBootstrap = async (sessionID, compact = false) => {
    const bootstrapContent = getBootstrapContent(compact);
    if (!bootstrapContent) return false;

    try {
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: bootstrapContent, synthetic: true }]
        }
      });
      return true;
    } catch (err) {
      return false;
    }
  };

  return {
    tool: {
      use_skill: tool({
        description: 'Load and read a specific skill to guide your work. Skills contain proven workflows, mandatory processes, and expert techniques.',
        args: {
          skill_name: tool.schema.string().describe('Name of the skill to load (e.g., "workflows:dev-implement", "my-custom-skill", or "project:my-skill")')
        },
        execute: async (args, context) => {
          const { skill_name } = args;

          // Resolve with priority: project > personal > workflows
          // Check for project: prefix first
          const forceProject = skill_name.startsWith('project:');
          const actualSkillName = forceProject ? skill_name.replace(/^project:/, '') : skill_name;

          let resolved = null;

          // Try project skills first (if project: prefix or no prefix)
          if (forceProject || !skill_name.startsWith('workflows:')) {
            const projectPath = path.join(projectSkillsDir, actualSkillName);
            const projectSkillFile = path.join(projectPath, 'SKILL.md');
            if (fs.existsSync(projectSkillFile)) {
              resolved = {
                skillFile: projectSkillFile,
                sourceType: 'project',
                skillPath: actualSkillName
              };
            }
          }

          // Fall back to personal/workflows resolution
          if (!resolved && !forceProject) {
            resolved = skillsCore.resolveSkillPath(skill_name, workflowsSkillsDir, personalSkillsDir);
          }

          if (!resolved) {
            return `Error: Skill "${skill_name}" not found.\n\nRun find_skills to see available skills.`;
          }

          const fullContent = fs.readFileSync(resolved.skillFile, 'utf8');
          const { name, description } = skillsCore.extractFrontmatter(resolved.skillFile);
          const content = skillsCore.stripFrontmatter(fullContent);
          const skillDirectory = path.dirname(resolved.skillFile);

          const skillHeader = `# ${name || skill_name}
# ${description || ''}
# Supporting tools and docs are in ${skillDirectory}
# ============================================`;

          // Insert as user message with noReply for persistence across compaction
          try {
            await client.session.prompt({
              path: { id: context.sessionID },
              body: {
                noReply: true,
                parts: [
                  { type: "text", text: `Loading skill: ${name || skill_name}`, synthetic: true },
                  { type: "text", text: `${skillHeader}\n\n${content}`, synthetic: true }
                ]
              }
            });
          } catch (err) {
            // Fallback: return content directly if message insertion fails
            return `${skillHeader}\n\n${content}`;
          }

          return `Launching skill: ${name || skill_name}`;
        }
      }),
      find_skills: tool({
        description: 'List all available skills in the project, personal, and workflows skill libraries.',
        args: {},
        execute: async (args, context) => {
          const projectSkills = skillsCore.findSkillsInDir(projectSkillsDir, 'project', 3);
          const personalSkills = skillsCore.findSkillsInDir(personalSkillsDir, 'personal', 3);
          const workflowsSkills = skillsCore.findSkillsInDir(workflowsSkillsDir, 'workflows', 3);

          // Priority: project > personal > workflows
          const allSkills = [...projectSkills, ...personalSkills, ...workflowsSkills];

          if (allSkills.length === 0) {
            return 'No skills found. Install workflows skills to ~/.config/opencode/workflows/skills/ or add project skills to .opencode/skills/';
          }

          let output = 'Available skills:\n\n';

          for (const skill of allSkills) {
            let namespace;
            switch (skill.sourceType) {
              case 'project':
                namespace = 'project:';
                break;
              case 'personal':
                namespace = '';
                break;
              default:
                namespace = 'workflows:';
            }
            const skillName = skill.name || path.basename(skill.path);

            output += `${namespace}${skillName}\n`;
            if (skill.description) {
              output += `  ${skill.description}\n`;
            }
            output += `  Directory: ${skill.path}\n\n`;
          }

          return output;
        }
      })
    },
    event: async ({ event }) => {
      // Extract sessionID from various event structures
      const getSessionID = () => {
        return event.properties?.info?.id ||
               event.properties?.sessionID ||
               event.session?.id;
      };

      // Inject bootstrap at session creation (before first user message)
      if (event.type === 'session.created') {
        const sessionID = getSessionID();
        if (sessionID) {
          await injectBootstrap(sessionID, false);
        }
      }

      // Re-inject bootstrap after context compaction (compact version to save tokens)
      if (event.type === 'session.compacted') {
        const sessionID = getSessionID();
        if (sessionID) {
          await injectBootstrap(sessionID, true);
        }
      }
    }
  };
};
