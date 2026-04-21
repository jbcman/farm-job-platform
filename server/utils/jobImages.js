'use strict';
/**
 * jobImages.js — PHASE VISUAL_JOB_LITE
 *
 * 카테고리별 기본 이미지 매핑.
 * farmImages / imageUrl 둘 다 없을 때 fallback으로 사용.
 */
const DEFAULT_IMAGES = {
    '밭갈이':    '/images/default_plowing.jpg',
    '로터리':    '/images/default_rotary.jpg',
    '두둑':      '/images/default_ridge.jpg',
    '방제':      '/images/default_spraying.jpg',
    '수확 일손': '/images/default_harvest.jpg',
    '예초':      '/images/default_weeding.jpg',
};

const FALLBACK_IMAGE = '/images/default_farm.jpg';

/**
 * 카테고리에 맞는 기본 이미지 URL 반환.
 * @param {string} category  jobs.category 값
 * @returns {string}
 */
function getDefaultImage(category) {
    return DEFAULT_IMAGES[category] || FALLBACK_IMAGE;
}

module.exports = { getDefaultImage, DEFAULT_IMAGES, FALLBACK_IMAGE };
