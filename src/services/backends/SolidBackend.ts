import Backend from '@/services/backends/Backend';

import List from '@/models/List';
import Task from '@/models/Task';
import Workspace from '@/models/Workspace';
import SolidUser from '@/models/users/SolidUser';

import Solid, { Resource } from '@/utils/Solid';

const TASK = 'http://purl.org/vocab/lifecycle/schema#Task';
const TASK_GROUP = 'http://purl.org/vocab/lifecycle/schema#TaskGroup';

const ACTIVITY = 'https://www.w3.org/ns/prov#Activity';
const COMPLETED_AT = 'http://purl.org/net/provenance/ns#completedAt';

export default class SolidBackend extends Backend<SolidUser> {

    public async loadWorkspaces(user: SolidUser): Promise<Workspace[]> {
        const containers = [];
        for (const podUrl of user.pods) {
            containers.push(... await Solid.getContainers(podUrl, [TASK_GROUP]));
        }

        return await Promise.all(
            containers.map(
                container => this.createWorkspaceFromResource(container)
            )
        );
    }

    public async unloadWorkspaces(): Promise<void> {
        // nothing to do here
    }

    public async loadWorkspace(workspace: Workspace): Promise<void> {
        if (!workspace.loaded && !workspace.loading) {
            workspace.loading = true;

            const childContainers = await Solid.getContainers(workspace.id, [TASK_GROUP]);

            for (const childContainer of childContainers) {
                if (childContainer.url !== workspace.id) {
                    const list = await this.createListFromResource(childContainer);

                    list.setWorkspace(workspace);
                    workspace.lists.push(list);
                }
            }

            workspace.loaded = true;
            workspace.loading = false;
        }
    }

    public async createWorkspace(storage: string, name: string): Promise<Workspace> {
        const resource = await Solid.createContainer(storage, name, [TASK_GROUP]);

        return await this.createWorkspaceFromResource(resource);
    }

    public async loadList(list: List): Promise<void> {
        if (!list.loaded && !list.loading) {
            list.loading = true;

            const resources = list.id === null
                ? await Solid.getResources(list.workspace.id, [TASK, ACTIVITY])
                : await Solid.getResources(list.id, [TASK, ACTIVITY]);

            for (const childResource of resources) {
                list.add(this.createTaskFromResource(childResource));
            }

            list.loaded = true;
            list.loading = false;
        }
    }

    public async createList(workspace: Workspace, name: string): Promise<List> {
        const container = await Solid.createContainer(workspace.id, name, [TASK_GROUP]);
        const list = await this.createListFromResource(container);

        list.setWorkspace(workspace);

        workspace.addList(list);

        return list;
    }

    public async createTask(list: List, name: string): Promise<Task> {
        const parentUrl = list.id || list.workspace.id;
        const resource = await Solid.createResource(parentUrl, name, [TASK, ACTIVITY]);
        const task = this.createTaskFromResource(resource);

        list.add(task);

        return task;
    }

    public async toggleTask(task: Task): Promise<void> {
        task.toggle();

        if (task.isCompleted()) {
            await Solid.updateResourceProperties(task.id, {
                [COMPLETED_AT]: task.completedAt.toISOString(),
            });
        } else {
            await Solid.removeResourceProperties(task.id, [COMPLETED_AT]);
        }
    }

    private async createWorkspaceFromResource(resource: Resource): Promise<Workspace> {
        const inbox = new List(null, 'Inbox', []);
        const workspace = new Workspace(resource.url, resource.name, [inbox], inbox);

        inbox.setWorkspace(workspace);

        return workspace;
    }

    private async createListFromResource(resource: Resource): Promise<List> {
        return new List(resource.url, resource.name, []);
    }

    private createTaskFromResource(resource: Resource): Task {
        const completedAt = Solid.getResourceAttribute(resource, COMPLETED_AT, null);

        return new Task(
            resource.url,
            resource.name,
            completedAt ? new Date(completedAt) : undefined
        );
    }

}
