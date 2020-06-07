/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, VSBufferReadableStream } from 'vs/base/common/buffer';
import { isUNC } from 'vs/base/common/extpath';
import { Schemas } from 'vs/base/common/network';
import { sep } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';
import { getWebviewContentMimeType } from 'vs/platform/webview/common/mimeTypes';

export namespace WebviewResourceResponse {
	export enum Type { Success, Failed, AccessDenied }

	export class StreamSuccess {
		readonly type = Type.Success;

		constructor(
			public readonly stream: VSBufferReadableStream,
			public readonly mimeType: string
		) { }
	}

	export class BufferSuccess {
		readonly type = Type.Success;

		constructor(
			public readonly buffer: VSBuffer,
			public readonly mimeType: string
		) { }
	}

	export const Failed = { type: Type.Failed } as const;
	export const AccessDenied = { type: Type.AccessDenied } as const;

	export type BufferResponse = BufferSuccess | typeof Failed | typeof AccessDenied;
	export type StreamResponse = StreamSuccess | typeof Failed | typeof AccessDenied;
}

export async function loadLocalResource(
	requestUri: URI,
	fileService: IFileService,
	extensionLocation: URI | undefined,
	roots: ReadonlyArray<URI>
): Promise<WebviewResourceResponse.BufferResponse> {
	const resourceToLoad = getResourceToLoad(requestUri, extensionLocation, roots);
	if (!resourceToLoad) {
		return WebviewResourceResponse.AccessDenied;
	}

	try {
		const data = await fileService.readFile(resourceToLoad);
		const mime = getWebviewContentMimeType(requestUri); // Use the original path for the mime
		return new WebviewResourceResponse.BufferSuccess(data.value, mime);
	} catch (err) {
		console.log(err);
		return WebviewResourceResponse.Failed;
	}
}

export async function loadLocalResourceStream(
	requestUri: URI,
	fileService: IFileService,
	extensionLocation: URI | undefined,
	roots: ReadonlyArray<URI>
): Promise<WebviewResourceResponse.StreamResponse> {
	const resourceToLoad = getResourceToLoad(requestUri, extensionLocation, roots);
	if (!resourceToLoad) {
		return WebviewResourceResponse.AccessDenied;
	}

	try {
		const contents = await fileService.readFileStream(resourceToLoad);
		const mime = getWebviewContentMimeType(requestUri); // Use the original path for the mime
		return new WebviewResourceResponse.StreamSuccess(contents.value, mime);
	} catch (err) {
		console.log(err);
		return WebviewResourceResponse.Failed;
	}
}

function getResourceToLoad(
	requestUri: URI,
	extensionLocation: URI | undefined,
	roots: ReadonlyArray<URI>
): URI | undefined {
	const normalizedPath = normalizeRequestPath(requestUri);

	for (const root of roots) {
		if (!containsResource(root, normalizedPath)) {
			continue;
		}

		if (extensionLocation && extensionLocation.scheme === REMOTE_HOST_SCHEME) {
			return URI.from({
				scheme: REMOTE_HOST_SCHEME,
				authority: extensionLocation.authority,
				path: '/vscode-resource',
				query: JSON.stringify({
					requestResourcePath: normalizedPath.path
				})
			});
		} else {
			return normalizedPath;
		}
	}

	return undefined;
}

function normalizeRequestPath(requestUri: URI) {
	if (requestUri.scheme === Schemas.vscodeWebviewResource) {
		// The `vscode-webview-resource` scheme has the following format:
		//
		// vscode-webview-resource://id/scheme//authority?/path
		//
		const resourceUri = URI.parse(requestUri.path.replace(/^\/([a-z0-9\-]+)\/{1,2}/i, '$1://'));

		return resourceUri.with({
			query: requestUri.query,
			fragment: requestUri.fragment
		});
	} else if (requestUri.scheme === Schemas.oldVscodeWebviewResource) {
		// Modern `vscode-resource` uris puts the scheme as the authority
		if (requestUri.authority) {
			const resourceUri = URI.parse(`${requestUri.authority}:${encodeURIComponent(requestUri.path).replace(/%2F/g, '/')}`);
			return resourceUri.with({
				query: requestUri.query,
				fragment: requestUri.fragment
			});
		}

		// Old style vscode-resource uris lose the scheme of the resource which means they are unable to
		// load a mix of local and remote content properly.
		return requestUri.with({ scheme: 'file' });
	} else {
		return requestUri;
	}
}

function containsResource(root: URI, resource: URI): boolean {
	let rootPath = root.fsPath + (root.fsPath.endsWith(sep) ? '' : sep);
	let resourceFsPath = resource.fsPath;

	if (isUNC(root.fsPath) && isUNC(resource.fsPath)) {
		rootPath = rootPath.toLowerCase();
		resourceFsPath = resourceFsPath.toLowerCase();
	}

	return resourceFsPath.startsWith(rootPath);
}
