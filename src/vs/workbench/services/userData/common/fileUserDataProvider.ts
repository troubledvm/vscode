/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IFileSystemProviderWithFileReadWriteCapability, IFileChange, IWatchOptions, IStat, FileOverwriteOptions, FileType, FileWriteOptions, FileDeleteOptions, FileSystemProviderCapabilities, IFileSystemProviderWithOpenReadWriteCloseCapability, FileOpenOptions, hasReadWriteCapability, hasOpenReadWriteCloseCapability, IFileSystemProviderWithFileReadStreamCapability, FileReadStreamOptions, hasFileReadStreamCapability } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { extUriBiasedIgnorePathCase as resources } from 'vs/base/common/resources';
import { startsWith } from 'vs/base/common/strings';
import { BACKUPS } from 'vs/platform/environment/common/environment';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ReadableStreamEvents } from 'vs/base/common/stream';
import { ILogService } from 'vs/platform/log/common/log';

export class FileUserDataProvider extends Disposable implements
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileReadStreamCapability {

	readonly capabilities: FileSystemProviderCapabilities = this.fileSystemProvider.capabilities;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

	private readonly userDataHome: URI;

	constructor(
		private readonly fileSystemUserDataHome: URI,
		private readonly fileSystemBackupsHome: URI,
		private readonly fileSystemProvider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability,
		environmentService: IWorkbenchEnvironmentService,
		private readonly logService: ILogService,
	) {
		super();

		this.userDataHome = environmentService.userRoamingDataHome;

		// Assumption: This path always exists
		this._register(this.fileSystemProvider.watch(this.fileSystemUserDataHome, { recursive: false, excludes: [] }));
		this._register(this.fileSystemProvider.onDidChangeFile(e => this.handleFileChanges(e)));
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		return this.fileSystemProvider.watch(this.toFileSystemResource(resource), opts);
	}

	stat(resource: URI): Promise<IStat> {
		return this.fileSystemProvider.stat(this.toFileSystemResource(resource));
	}

	mkdir(resource: URI): Promise<void> {
		return this.fileSystemProvider.mkdir(this.toFileSystemResource(resource));
	}

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
		return this.fileSystemProvider.rename(this.toFileSystemResource(from), this.toFileSystemResource(to), opts);
	}

	readFile(resource: URI): Promise<Uint8Array> {
		if (hasReadWriteCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.readFile(this.toFileSystemResource(resource));
		}
		throw new Error('not supported');
	}

	readFileStream(resource: URI, opts: FileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array> {
		if (hasFileReadStreamCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.readFileStream(this.toFileSystemResource(resource), opts, token);
		}
		throw new Error('not supported');
	}

	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.fileSystemProvider.readdir(this.toFileSystemResource(resource));
	}

	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		if (hasReadWriteCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.writeFile(this.toFileSystemResource(resource), content, opts);
		}
		throw new Error('not supported');
	}

	open(resource: URI, opts: FileOpenOptions): Promise<number> {
		if (hasOpenReadWriteCloseCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.open(this.toFileSystemResource(resource), opts);
		}
		throw new Error('not supported');
	}

	close(fd: number): Promise<void> {
		if (hasOpenReadWriteCloseCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.close(fd);
		}
		throw new Error('not supported');
	}

	read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		if (hasOpenReadWriteCloseCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.read(fd, pos, data, offset, length);
		}
		throw new Error('not supported');
	}

	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		if (hasOpenReadWriteCloseCapability(this.fileSystemProvider)) {
			return this.fileSystemProvider.write(fd, pos, data, offset, length);
		}
		throw new Error('not supported');
	}

	delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		return this.fileSystemProvider.delete(this.toFileSystemResource(resource), opts);
	}

	private handleFileChanges(changes: readonly IFileChange[]): void {
		const userDataChanges: IFileChange[] = [];
		for (const change of changes) {
			const userDataResource = this.toUserDataResource(change.resource);
			if (userDataResource) {
				userDataChanges.push({
					resource: userDataResource,
					type: change.type
				});
			}
		}
		if (userDataChanges.length) {
			this.logService.debug('User data changed');
			this._onDidChangeFile.fire(userDataChanges);
		}
	}

	private toFileSystemResource(userDataResource: URI): URI {
		const relativePath = resources.relativePath(this.userDataHome, userDataResource)!;
		if (startsWith(relativePath, BACKUPS)) {
			return resources.joinPath(resources.dirname(this.fileSystemBackupsHome), relativePath);
		}
		return resources.joinPath(this.fileSystemUserDataHome, relativePath);
	}

	private toUserDataResource(fileSystemResource: URI): URI | null {
		if (resources.isEqualOrParent(fileSystemResource, this.fileSystemUserDataHome)) {
			const relativePath = resources.relativePath(this.fileSystemUserDataHome, fileSystemResource);
			return relativePath ? resources.joinPath(this.userDataHome, relativePath) : this.userDataHome;
		}
		if (resources.isEqualOrParent(fileSystemResource, this.fileSystemBackupsHome)) {
			const relativePath = resources.relativePath(this.fileSystemBackupsHome, fileSystemResource);
			return relativePath ? resources.joinPath(this.userDataHome, BACKUPS, relativePath) : resources.joinPath(this.userDataHome, BACKUPS);
		}
		return null;
	}

}
