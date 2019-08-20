/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import ko from 'knockout';
import {Environment} from 'Util/Environment';

import {Logger, getLogger} from 'Util/Logger';
import {loadValue, storeValue} from 'Util/StorageUtil';
import {koArrayPushAll} from 'Util/util';

import {MediaDeviceType} from './MediaDeviceType';

type DeviceTypes = 'audioInput' | 'audioOutput' | 'screenInput' | 'videoInput';

type Devices = Record<DeviceTypes, ko.ObservableArray<MediaDeviceInfo>>;
type DeviceIds = Record<DeviceTypes, ko.Observable<string>>;
export type CurrentAvailableDeviceId = Record<DeviceTypes, ko.PureComputed<string>>;
export type DeviceSupport = Record<DeviceTypes, ko.PureComputed<boolean>>;
declare global {
  interface Window {
    desktopCapturer: any;
  }
}

interface Config {
  DEFAULT_DEVICE: Record<DeviceTypes, string>;
}

export class MediaDevicesHandler {
  private readonly logger: Logger;
  public availableDevices: Devices;
  public currentDeviceId: DeviceIds;
  public currentAvailableDeviceId: CurrentAvailableDeviceId;
  public deviceSupport: DeviceSupport;

  static get CONFIG(): Config {
    return {
      DEFAULT_DEVICE: {
        audioInput: 'default',
        audioOutput: 'default',
        screenInput: 'screen',
        videoInput: 'default',
      },
    };
  }

  /**
   * Construct a new MediaDevices handler.
   */
  constructor() {
    this.logger = getLogger('MediaDevicesHandler');

    this.availableDevices = {
      audioInput: ko.observableArray([]),
      audioOutput: ko.observableArray([]),
      screenInput: ko.observableArray([]),
      videoInput: ko.observableArray([]),
    };

    this.currentDeviceId = {
      audioInput: ko.observable(loadValue(MediaDeviceType.AUDIO_INPUT)),
      audioOutput: ko.observable(loadValue(MediaDeviceType.AUDIO_OUTPUT)),
      screenInput: ko.observable(loadValue(MediaDeviceType.SCREEN_INPUT)),
      videoInput: ko.observable(loadValue(MediaDeviceType.VIDEO_INPUT)),
    };

    const getCurrentAvailableDeviceId = (deviceType: DeviceTypes): string => {
      const currentDeviceId = this.currentDeviceId[deviceType]();
      if (this.availableDevices[deviceType]().length === 0) {
        return '';
      }
      const isAvailable = this.availableDevices[deviceType]().find(
        device => (device.deviceId || (device as any).id) === currentDeviceId,
      );
      if (isAvailable) {
        return currentDeviceId;
      }
      return MediaDevicesHandler.CONFIG.DEFAULT_DEVICE[deviceType];
    };

    this.currentAvailableDeviceId = {
      audioInput: ko.pureComputed(() => getCurrentAvailableDeviceId('audioInput')),
      audioOutput: ko.pureComputed(() => getCurrentAvailableDeviceId('audioOutput')),
      screenInput: ko.pureComputed(() => getCurrentAvailableDeviceId('screenInput')),
      videoInput: ko.pureComputed(() => getCurrentAvailableDeviceId('videoInput')),
    };

    this.deviceSupport = {
      audioInput: ko.pureComputed(() => !!this.availableDevices.audioInput().length),
      audioOutput: ko.pureComputed(() => !!this.availableDevices.audioOutput().length),
      screenInput: ko.pureComputed(() => !!this.availableDevices.screenInput().length),
      videoInput: ko.pureComputed(() => !!this.availableDevices.videoInput().length),
    };

    this._initializeMediaDevices();
  }

  /**
   * Initialize the list of MediaDevices and subscriptions.
   * @returns {undefined} No return value
   */
  _initializeMediaDevices(): void {
    if (Environment.browser.supports.mediaDevices) {
      this.refreshMediaDevices().then(() => {
        this._subscribeToObservables();
        this._subscribeToDevices();
      });
    }
  }

  /**
   * Subscribe to MediaDevices updates if available.
   * @returns {undefined} No return value
   */
  _subscribeToDevices(): void {
    navigator.mediaDevices.ondevicechange = () => {
      this.logger.info('List of available MediaDevices has changed');
      this.refreshMediaDevices();
    };
  }

  /**
   * Subscribe to Knockout observables.
   * @returns {undefined} No return value
   */
  _subscribeToObservables(): void {
    this.currentDeviceId.audioInput.subscribe(mediaDeviceId => {
      storeValue(MediaDeviceType.AUDIO_INPUT, mediaDeviceId);
    });

    this.currentDeviceId.audioOutput.subscribe(mediaDeviceId => {
      storeValue(MediaDeviceType.AUDIO_OUTPUT, mediaDeviceId);
    });

    this.currentDeviceId.videoInput.subscribe(mediaDeviceId => {
      storeValue(MediaDeviceType.VIDEO_INPUT, mediaDeviceId);
    });
  }

  /**
   * Update list of available MediaDevices.
   * @returns {Promise} Resolves with all MediaDevices when the list has been updated
   */
  refreshMediaDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices
      .enumerateDevices()
      .catch(error => {
        this.logger.error(`Failed to update MediaDevice list: ${error.message}`, error);
        throw error;
      })
      .then(mediaDevices => {
        this._removeAllDevices();

        if (mediaDevices) {
          const audioInputDevices: MediaDeviceInfo[] = [];
          const audioOutputDevices: MediaDeviceInfo[] = [];
          const videoInputDevices: MediaDeviceInfo[] = [];

          mediaDevices.forEach(mediaDevice => {
            switch (mediaDevice.kind) {
              case MediaDeviceType.AUDIO_INPUT: {
                audioInputDevices.push(mediaDevice);
                break;
              }

              case MediaDeviceType.AUDIO_OUTPUT: {
                audioOutputDevices.push(mediaDevice);
                break;
              }

              case MediaDeviceType.VIDEO_INPUT: {
                videoInputDevices.push(mediaDevice);
                break;
              }
            }
          });

          koArrayPushAll(this.availableDevices.audioInput, audioInputDevices);
          koArrayPushAll(this.availableDevices.audioOutput, audioOutputDevices);
          koArrayPushAll(this.availableDevices.videoInput, videoInputDevices);

          this.logger.info('Updated MediaDevice list', mediaDevices);
          return mediaDevices;
        }
        throw new Error('No media devices found');
      });
  }

  /**
   * Update list of available screens.
   * @returns {Promise} resolves with all screen sources when the list has been updated
   */
  getScreenSources(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options = {
        thumbnailSize: {
          height: 176,
          width: 312,
        },
        types: [MediaDevicesHandler.CONFIG.DEFAULT_DEVICE.screenInput],
      };

      return window.desktopCapturer.getSources(options, (error: Error, screenSources: MediaDeviceInfo[]) => {
        if (error) {
          return reject(error);
        }
        this.logger.info(`Detected '${screenSources.length}' sources for screen sharing from Electron`, screenSources);
        this.availableDevices.screenInput(screenSources);
        return resolve(screenSources);
      });
    });
  }

  /**
   * Remove all known MediaDevices from the lists.
   * @private
   * @returns {undefined} No return value
   */
  _removeAllDevices(): void {
    this.availableDevices.audioInput.removeAll();
    this.availableDevices.audioOutput.removeAll();
    this.availableDevices.videoInput.removeAll();
  }
}